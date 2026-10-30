import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { db } from "../data/db";
import type { PartAnswer } from "../data/types";
import { requestSync } from "../lib/sync";
import { EDITOR_EXTENSIONS } from "./Editor";
import { CommentHighlights, commentHighlightsKey, TrackChanges, trackChangesKey } from "./trackChangesExtension";
import type { AnswerComment } from "../data/types";

interface Props {
  attemptId: string;
  answer: PartAnswer;
  /** Hide the tracked-changes markup and show the revised text clean. */
  clean: boolean;
  /** The margin comments on this part, whose highlights the editor draws; and the one open. */
  comments?: AnswerComment[];
  active?: string | null;
  /** Called after the text changed, so the margin can line its cards up again. */
  onLayout?: () => void;
}

/**
 * The submitted answer, open for revising after the model answer has been read. What is
 * typed is kept as a revision beside the answer, which stays exactly as it was submitted, so
 * marks and history still refer to the real attempt. Saves itself as you type.
 */
export default function RevisedAnswer({ attemptId, answer, clean, comments = [], active = null, onLayout }: Props) {
  const [saved, setSaved] = useState(false);
  const timer = useRef(0);
  const editor = useEditor({
    extensions: [...EDITOR_EXTENSIONS, TrackChanges.configure({ original: answer.doc, originalText: answer.text }), CommentHighlights.configure({ original: answer.doc, originalText: answer.text })],
    content: ((answer.revision?.doc ?? answer.doc) as object | null) ?? (answer.text ? { type: "doc", content: answer.text.split(/\r?\n/).map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] })) } : undefined),
    editorProps: { attributes: { role: "textbox", "aria-label": "Your revised answer", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => {
      onLayout?.();
      const doc = editor.getJSON(); const text = editor.getText({ blockSeparator: "\n" });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void db.transaction("rw", db.attempts, async () => {
          const attempt = await db.attempts.get(attemptId);
          if (!attempt) return;
          const has = attempt.answers.some((a) => a.label === answer.label);
          const answers = has ? attempt.answers.map((a) => a.label === answer.label ? { ...a, revision: { doc, text, at: Date.now() } } : a) : [...attempt.answers, { label: answer.label, text: "", doc: null, revision: { doc, text, at: Date.now() } }];
          await db.attempts.update(attemptId, { answers });
        }).then(() => { requestSync(); setSaved(true); window.setTimeout(() => setSaved(false), 1500); });
      }, 700);
    },
  });
  useEffect(() => { if (editor) editor.view.dispatch(editor.state.tr.setMeta(trackChangesKey, { shown: !clean })); }, [editor, clean]);
  const anchored = comments.filter((c) => c.partLabel === answer.label && !c.replyTo && !(c.start === 0 && c.end === 0 && !c.quote));
  const anchoredKey = anchored.map((c) => `${c.id}:${c.start}:${c.end}`).join("|");
  useEffect(() => { if (editor) { editor.view.dispatch(editor.state.tr.setMeta(commentHighlightsKey, { comments: anchored.map((c) => ({ id: c.id, start: c.start, end: c.end, quote: c.quote })), active })); onLayout?.(); } }, [editor, anchoredKey, active]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { editor?.commands.focus("end"); }, [editor]);
  if (!editor) return null;
  return <div className={"revise-box" + (clean ? " clean" : "")}>
    <EditorContent editor={editor} />
    <span className="muted revise-saved" role="status" aria-live="polite">{saved ? "Saved" : ""}</span>
  </div>;
}
