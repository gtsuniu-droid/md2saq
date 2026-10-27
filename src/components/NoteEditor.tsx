import { EditorContent, generateHTML, useEditor, useEditorState, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { NoteImage } from "../lib/noteImage";
import { TableKit } from "@tiptap/extension-table";
import { TextStyle, Color, FontSize } from "@tiptap/extension-text-style";
import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";
import { useEditorImages } from "./useEditorImages";

export const NOTE_EXTENSIONS = [StarterKit.configure({ link: { openOnClick: false } }), TextStyle, Color, FontSize, Highlight, NoteImage.configure({ allowBase64: true, resize: { enabled: true, directions: ["top-left", "top-right", "bottom-left", "bottom-right"], minWidth: 48, minHeight: 32, alwaysPreserveAspectRatio: true } }), TableKit];
export function noteHtml(doc: unknown): string {
  try { return DOMPurify.sanitize(generateHTML(doc as JSONContent, NOTE_EXTENSIONS)); } catch { return ""; }
}

export default function NoteEditor({ initial, onChange, onBusyChange, label = "Note content", syncContent = false, compact = false }: { initial: unknown; onChange: (doc: unknown, text: string) => void; onBusyChange?: (busy: boolean) => void; label?: string; syncContent?: boolean; compact?: boolean }) {
  const [more, setMore] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const colourInput = useRef<HTMLInputElement>(null);
  const colourMenu = useRef<HTMLDetailsElement>(null);
  const images = useEditorImages(onBusyChange);
  const { addingImages, draggingImages, error, addImages } = images;
  const editor = useEditor({
    extensions: NOTE_EXTENSIONS,
    content: noteHtml(initial),
    editorProps: {
      attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true" },
      transformPastedHTML: (html) => DOMPurify.sanitize(html),
      ...images.editorProps,
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON(), editor.getText()),
  });
  images.editorRef.current = editor;
  useEffect(() => {
    if (syncContent && editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(initial)) {
      editor.commands.setContent(noteHtml(initial), { emitUpdate: false });
    }
  }, [editor, initial, syncContent]);
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor.isActive("bold"), italic: editor.isActive("italic"), highlight: editor.isActive("highlight"), table: editor.isActive("table"), image: editor.isActive("image"), colour: editor.getAttributes("textStyle").color as string | undefined, fontSize: editor.getAttributes("textStyle").fontSize as string | undefined }) });
  const applyColour = (colour?: string) => {
    if (colour) editor?.chain().focus().setColor(colour).run(); else editor?.chain().focus().unsetColor().run();
    if (colourMenu.current) colourMenu.current.open = false;
  };
  if (!editor) return null;
  return <div className={`note-editor${draggingImages ? " image-drop-target" : ""}`} {...images.dropProps}>
    <div className="toolbar row" aria-label={`${label} formatting`}>
      <button type="button" aria-label="Bold" aria-pressed={active?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
      <button type="button" aria-label="Italic" aria-pressed={active?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button type="button" onClick={() => imageInput.current?.click()}>Picture</button>
      <button type="button" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>Table</button>
      {compact && <button type="button" aria-expanded={more} onClick={() => setMore(!more)}>More</button>}
      {(!compact || more) && <>
      <button type="button" aria-label="Highlight" aria-pressed={active?.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}><mark>H</mark></button>
      <select className="note-font-size" aria-label="Text size" title="Text size" value={active?.fontSize || ""} onChange={(e) => {
        if (e.target.value) editor.chain().focus().setFontSize(e.target.value).run(); else editor.chain().focus().unsetFontSize().run();
      }}><option value="">Default size</option>{[12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map((size) => <option key={size} value={`${size}px`}>{size}</option>)}{active?.fontSize && ![12, 14, 16, 18, 20, 24, 28, 32, 36, 48].some((size) => `${size}px` === active.fontSize) && <option value={active.fontSize}>{active.fontSize}</option>}</select>
      <details className="note-colour-menu" ref={colourMenu} onKeyDown={(e) => { if (e.key === "Escape" && colourMenu.current) { colourMenu.current.open = false; colourMenu.current.querySelector("summary")?.focus(); } }}>
        <summary aria-label="Text colour" title="Text colour"><span className="note-colour-circle" style={{ backgroundColor: active?.colour || "var(--fg)" }} /></summary>
        <div className="note-colour-options" role="group" aria-label="Text colours">
          <div className="row">
            {[{ name: "Default", value: undefined }, { name: "Red", value: "#b91c1c" }, { name: "Blue", value: "#1d4ed8" }, { name: "Purple", value: "#7e22ce" }].map((colour) => <button key={colour.name} type="button" className="note-colour-choice" aria-label={`${colour.name} text colour`} title={colour.name} onMouseDown={(e) => e.preventDefault()} onClick={() => applyColour(colour.value)}><span className="note-colour-circle" style={{ backgroundColor: colour.value || "var(--fg)" }} /></button>)}
          </div>
          <label>Custom colour <input ref={colourInput} type="color" aria-label="Choose text colour" defaultValue="#15803d" /></label>
          <button type="button" className="small" onClick={() => applyColour(colourInput.current?.value)}>Apply colour</button>
        </div>
      </details>
      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</button>
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}>Bullets</button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()}>Numbered</button>
      {active?.table && <><button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</button><button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</button><button type="button" onClick={() => editor.chain().focus().deleteTable().run()}>Remove table</button></>}
      <button type="button" aria-label="Undo" onClick={() => editor.chain().focus().undo().run()}>Undo</button>
      </>}
      <input hidden type="file" accept="image/*" multiple ref={imageInput} onChange={(e) => { void addImages([...e.target.files ?? []]); e.target.value = ""; }} />
    </div>
    {active?.image && <div className="note-image-tools row" role="group" aria-label="Picture controls"><span>Resize with the corners</span><button type="button" className="small" onClick={() => editor.chain().focus().updateAttributes("image", { width: null, height: null }).run()}>Original size</button><button type="button" className="small" onClick={() => editor.chain().focus().deleteSelection().run()}>Remove picture</button></div>}
    {addingImages && <p className="note-editor-hint muted" role="status">Adding pictures…</p>}
    {error && <p role="alert">{error}</p>}
    <EditorContent editor={editor} />

  </div>;
}
