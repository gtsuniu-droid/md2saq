import { generateHTML } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { AnswerComment } from "../data/types";
import { newId } from "../data/db";
import { EDITOR_EXTENSIONS } from "./Editor";
import { commentSegments, deleteAnswerComment, validCommentAnchor, writeAnswerComment, type AnswerAnchor } from "../lib/answerComments";
import { requestSync } from "../lib/sync";

interface Props { attemptId: string; partLabel: string; doc: unknown; text?: string; comments: AnswerComment[] }

/** Comments belong to the submitted answer, independently of whether it has been marked. */
export default function CommentedAnswer({ attemptId, partLabel, doc, text = "", comments }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<AnswerAnchor | null>(null);
  const [draft, setDraft] = useState<AnswerComment | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const mine = comments.filter((c) => c.partLabel === partLabel);
  const current = mine.find((c) => c.id === active);
  const rendered = useMemo(() => {
    let html = "";
    try { if (doc && typeof doc === "object") html = generateHTML(doc as Parameters<typeof generateHTML>[0], EDITOR_EXTENSIONS); } catch { /* Legacy plain answer. */ }
    const container = document.createElement("div");
    if (html) container.innerHTML = DOMPurify.sanitize(html);
    else { const p = document.createElement("p"); p.className = "pre"; p.textContent = text || "No answer written."; container.append(p); }
    const plain = container.textContent ?? "";
    const valid = comments.filter((c) => c.partLabel === partLabel && validCommentAnchor(plain, c));
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node as Text);
    let offset = 0;
    for (const node of nodes) {
      const value = node.data;
      const fragment = document.createDocumentFragment();
      for (const segment of commentSegments(value, valid, offset)) {
        if (!segment.ids.length) { fragment.append(document.createTextNode(segment.text)); continue; }
        const highlight = document.createElement("mark");
        highlight.className = "answer-comment-highlight";
        highlight.dataset.commentIds = JSON.stringify(segment.ids);
        highlight.setAttribute("role", "button"); highlight.tabIndex = 0;
        highlight.setAttribute("aria-label", `Comment on: ${segment.text}`);
        highlight.textContent = segment.text;
        fragment.append(highlight);
      }
      offset += value.length;
      node.replaceWith(fragment);
    }
    return { html: container.innerHTML, plain };
  }, [doc, text, comments, partLabel]);
  useEffect(() => { if (draft) input.current?.focus(); }, [draft?.id]);
  useEffect(() => { setSelection(null); setDraft(null); setActive(null); setShowList(false); setStatus(""); }, [attemptId, partLabel]);

  const captureSelection = () => {
    if (draft || !root.current || !text && !doc) return;
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) { setSelection(null); return; }
    const range = selected.getRangeAt(0);
    if (!root.current.contains(range.startContainer) || !root.current.contains(range.endContainer)) { setSelection(null); return; }
    const prefix = range.cloneRange(); prefix.selectNodeContents(root.current); prefix.setEnd(range.startContainer, range.startOffset);
    let start = prefix.toString().length;
    let end = start + range.toString().length;
    while (start < end && /\s/.test(rendered.plain[start])) start++;
    while (end > start && /\s/.test(rendered.plain[end - 1])) end--;
    const anchor = { start, end, quote: rendered.plain.slice(start, end) };
    setSelection(validCommentAnchor(rendered.plain, anchor) ? anchor : null);
  };
  const openHighlight = (target: EventTarget) => {
    if (draft || window.getSelection()?.toString().trim()) return;
    const highlight = target instanceof Element ? target.closest<HTMLElement>("[data-comment-ids]") : null;
    if (highlight && root.current?.contains(highlight)) {
      const ids = JSON.parse(highlight.dataset.commentIds ?? "[]") as string[];
      setActive(ids[0] ?? null); setShowList(ids.length > 1); setStatus("");
    }
  };
  const save = async () => {
    if (!draft || busy || !draft.text.trim()) return;
    setBusy(true); setStatus("");
    try {
      if (!validCommentAnchor(rendered.plain, draft)) throw new Error("The selected passage changed. Select it again before commenting.");
      await writeAnswerComment(attemptId, draft, draft.updatedAt || undefined);
      requestSync(); setActive(draft.id); setDraft(null); setSelection(null); setStatus("Comment saved");
    } catch (e) { setStatus(e instanceof Error ? e.message : "Could not save comment."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!current || busy) return;
    setBusy(true);
    try { await deleteAnswerComment(attemptId, current.id, current.updatedAt); requestSync(); setActive(null); setStatus("Comment removed"); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Could not remove comment."); }
    finally { setBusy(false); }
  };
  return <div className="commented-answer">
    <div ref={root} className="answer-html" onPointerUp={captureSelection} onKeyUp={captureSelection} onClick={(e) => openHighlight(e.target)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { const target = e.target as HTMLElement; if (target.hasAttribute("data-comment-ids")) { e.preventDefault(); openHighlight(target); } } }} dangerouslySetInnerHTML={{ __html: rendered.html }} />
    <div className="answer-comment-tools">
      {selection && !draft && <button className="small" onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraft({ id: newId(), partLabel, ...selection, text: "", createdAt: 0, updatedAt: 0 }); setActive(null); setStatus(""); window.getSelection()?.removeAllRanges(); }}>Add comment</button>}
      {mine.length > 0 && <button className="small link" aria-expanded={showList} onClick={() => setShowList(!showList)}>Comments ({mine.length})</button>}
    </div>
    {showList && <div className="answer-comment-list">{mine.map((c) => <button className="small" key={c.id} onClick={() => { setActive(c.id); setDraft(null); }}><span>“{c.quote}”</span><span>{c.text}</span></button>)}</div>}
    {draft ? <div className="answer-comment-card" role="region" aria-label="Write a comment">
      <blockquote>{draft.quote}</blockquote>
      <textarea ref={input} aria-label="Comment" placeholder="Write a comment…" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); } if (e.key === "Escape" && !busy) setDraft(null); }} />
      <div className="row"><button className="primary small" disabled={busy || !draft.text.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save comment"}</button><button className="small" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
    </div> : current && <div className="answer-comment-card" role="region" aria-label="Answer comment">
      <blockquote>{current.quote}</blockquote><p className="pre">{current.text}</p>
      {!validCommentAnchor(rendered.plain, current) && <p className="muted">The original passage has changed.</p>}
      <div className="row"><button className="small" disabled={busy} onClick={() => { setDraft({ ...current }); setStatus(""); }}>Edit comment</button><button className="small link" disabled={busy} onClick={() => void remove()}>Remove comment</button><button className="small link" onClick={() => setActive(null)}>Close</button></div>
    </div>}
    {status && <p className="muted" role="status">{status}</p>}
  </div>;
}
