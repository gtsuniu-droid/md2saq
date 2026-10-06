import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { useEffect, useRef } from "react";

import { NoteImage } from "../lib/noteImage";
import { useEditorImages } from "./useEditorImages";

export const EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, link: false, code: false }),
  Highlight,
  NoteImage.configure({ allowBase64: true, resize: { enabled: true, directions: ["top-left", "top-right", "bottom-left", "bottom-right"], minWidth: 48, minHeight: 32, alwaysPreserveAspectRatio: true } }),
];

interface Props {
  initial: unknown;
  locked?: boolean;
  onChange: (doc: unknown, text: string) => void;
  onFocus?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export default function Editor({ initial, locked = false, onChange, onFocus, onBusyChange }: Props) {
  const imageInput = useRef<HTMLInputElement>(null);
  const images = useEditorImages(onBusyChange);
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: (initial as object | null) ?? undefined,
    editable: !locked,
    editorProps: { ...images.editorProps, attributes: { role: "textbox", "aria-label": "Your answer", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => onChange(editor.getJSON(), editor.getText()),
    onFocus: () => onFocus?.(),
  });

  images.editorRef.current = editor;

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
    <div className={"editor" + (locked ? " locked" : "") + (images.draggingImages ? " image-drop-target" : "")} {...images.dropProps}>
      <div className="toolbar">
        <button type="button" className={b(state.bold)} title="Bold (⌘B)" aria-label="Bold" aria-pressed={state.bold} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} disabled={locked}><b>B</b></button>
        <button type="button" className={b(state.italic)} title="Italic (⌘I)" aria-label="Italic" aria-pressed={state.italic} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} disabled={locked}><i>I</i></button>
        <button type="button" className={b(state.underline)} title="Underline (⌘U)" aria-label="Underline" aria-pressed={state.underline} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleUnderline().run()} disabled={locked}><u>U</u></button>
        <button type="button" className={b(state.highlight)} title="Highlight (⌘⇧H)" aria-label="Highlight" aria-pressed={state.highlight} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleHighlight().run()} disabled={locked}><mark>H</mark></button>
        <button type="button" disabled={locked || images.addingImages} onMouseDown={(e) => e.preventDefault()} onClick={() => imageInput.current?.click()}>Picture</button>
        <input hidden type="file" accept="image/*" multiple ref={imageInput} onChange={(e) => { void images.addImages(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      {images.addingImages && <p className="note-editor-hint muted" role="status">Adding pictures…</p>}
      {images.error && <p role="alert">{images.error}</p>}
      <EditorContent editor={editor} />
      <div className="wordcount">{state.words} words</div>
    </div>
  );
}
