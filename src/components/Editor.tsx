import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { useEffect } from "react";

export const EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, link: false, code: false }),
  Highlight,
];

interface Props {
  initial: unknown;
  locked?: boolean;
  onChange: (doc: unknown, text: string) => void;
  onFocus?: () => void;
}

export default function Editor({ initial, locked = false, onChange, onFocus }: Props) {
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: (initial as object | null) ?? undefined,
    editable: !locked,
    onUpdate: ({ editor }) => onChange(editor.getJSON(), editor.getText()),
    onFocus: () => onFocus?.(),
  });

  useEffect(() => {
    editor?.setEditable(!locked);
  }, [editor, locked]);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      underline: editor?.isActive("underline") ?? false,
      highlight: editor?.isActive("highlight") ?? false,
      words: (editor?.getText() ?? "").trim().split(/\s+/).filter(Boolean).length,
    }),
  });

  if (!editor) return null;
  const b = (on: boolean) => (on ? "active" : "");

  return (
    <div className={"editor" + (locked ? " locked" : "")}>
      <div className="toolbar">
        <button type="button" className={b(state.bold)} title="Bold (⌘B)" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }} disabled={locked}><b>B</b></button>
        <button type="button" className={b(state.italic)} title="Italic (⌘I)" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }} disabled={locked}><i>I</i></button>
        <button type="button" className={b(state.underline)} title="Underline (⌘U)" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }} disabled={locked}><u>U</u></button>
        <button type="button" className={b(state.highlight)} title="Highlight (⌘⇧H)" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHighlight().run(); }} disabled={locked}><mark>H</mark></button>
      </div>
      <EditorContent editor={editor} />
      <div className="wordcount">{state.words} words</div>
    </div>
  );
}
