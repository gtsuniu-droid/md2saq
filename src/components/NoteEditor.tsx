import { EditorContent, generateHTML, useEditor, useEditorState, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import DOMPurify from "dompurify";
import { useRef, useState } from "react";
import { compressImage } from "../lib/images";

export const NOTE_EXTENSIONS = [StarterKit.configure({ link: { openOnClick: false } }), TextStyle, Color, Highlight, Image.configure({ allowBase64: true }), TableKit];
export function noteHtml(doc: unknown): string {
  try { return DOMPurify.sanitize(generateHTML(doc as JSONContent, NOTE_EXTENSIONS)); } catch { return ""; }
}

export default function NoteEditor({ initial, onChange }: { initial: unknown; onChange: (doc: unknown, text: string) => void }) {
  const imageInput = useRef<HTMLInputElement>(null);
  const colourInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [moreColours, setMoreColours] = useState(false);
  const editor = useEditor({
    extensions: NOTE_EXTENSIONS,
    content: noteHtml(initial),
    editorProps: {
      attributes: { "aria-label": "Note content", role: "textbox", "aria-multiline": "true" },
      transformPastedHTML: (html) => DOMPurify.sanitize(html),
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        void addImages(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON(), editor.getText()),
  });
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor.isActive("bold"), italic: editor.isActive("italic"), highlight: editor.isActive("highlight"), table: editor.isActive("table") }) });
  async function addImages(files: File[]) {
    try {
      for (const file of files) {
        const src = await compressImage(file, 1100);
        editor?.chain().focus().setImage({ src, alt: file.name }).run();
      }
      setError("");
    } catch { setError("That picture could not be added. Try a PNG or JPEG."); }
  }
  if (!editor) return null;
  return <div className="note-editor">
    <div className="toolbar row" aria-label="Note formatting">
      <button type="button" aria-label="Bold" aria-pressed={active?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
      <button type="button" aria-label="Italic" aria-pressed={active?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button type="button" aria-label="Highlight" aria-pressed={active?.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}><mark>H</mark></button>
      <div className="note-text-colours row" role="group" aria-label="Text colour">
        <span>Text colour</span>
        <button type="button" aria-label="Default text colour" title="Default text colour" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().unsetColor().run()}>Default</button>
        <button type="button" aria-label="Red text" className="note-text-red" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setColor("#b91c1c").run()}>Red</button>
        <button type="button" aria-label="Blue text" className="note-text-blue" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setColor("#1d4ed8").run()}>Blue</button>
        <button type="button" aria-label="Purple text" className="note-text-purple" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setColor("#7e22ce").run()}>Purple</button>
        <button type="button" aria-expanded={moreColours} onClick={() => setMoreColours(!moreColours)}>More colours</button>
      </div>
      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</button>
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}>Bullets</button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()}>Numbered</button>
      <button type="button" onClick={() => imageInput.current?.click()}>Picture</button>
      <button type="button" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>Table</button>
      {active?.table && <><button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</button><button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</button><button type="button" onClick={() => editor.chain().focus().deleteTable().run()}>Remove table</button></>}
      <button type="button" aria-label="Undo" onClick={() => editor.chain().focus().undo().run()}>Undo</button>
      <input hidden type="file" accept="image/*" multiple ref={imageInput} onChange={(e) => { void addImages([...e.target.files ?? []]); e.target.value = ""; }} />
    </div>
    {moreColours && <div className="note-custom-colours row" role="group" aria-label="Custom text colour">
      <label>Choose a colour <input ref={colourInput} type="color" aria-label="Choose text colour" defaultValue="#15803d" /></label>
      <button type="button" className="small" onClick={() => editor.chain().focus().setColor(colourInput.current?.value || "#15803d").run()}>Apply colour</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    <EditorContent editor={editor} />
    <p className="muted note-editor-hint">Paste formatted notes, tables or pictures. Select text to change its colour, or choose a colour before typing. Use Tab to indent a list.</p>
  </div>;
}
