import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { noteHtml } from "./NoteEditor";
import { scaleNoteText } from "../lib/noteReading";

const KEY = "saq-note-reading-size";
const SIZES = [85, 100, 115, 130, 150, 175, 200];
function savedSize() {
  try { const size = Number(localStorage.getItem(KEY)); return SIZES.includes(size) ? size : 100; } catch { return 100; }
}
export function useNoteReadingSize() {
  const [size, setSize] = useState(savedSize);
  useEffect(() => {
    const update = () => setSize(savedSize());
    window.addEventListener("storage", update);
    window.addEventListener("note-reading-size", update);
    return () => { window.removeEventListener("storage", update); window.removeEventListener("note-reading-size", update); };
  }, []);
  const change = (next: number) => {
    try { localStorage.setItem(KEY, String(next)); window.dispatchEvent(new Event("note-reading-size")); } catch { /* Still usable without browser storage. */ }
    setSize(next);
  };
  return [size, change] as const;
}
export function NoteReadingControls({ size, onChange }: { size: number; onChange: (size: number) => void }) {
  const index = SIZES.indexOf(size);
  return <div className="note-reading-controls row" role="group" aria-label="Reading text size">
    <span>Reading size</span>
    <button type="button" className="small" aria-label="Decrease reading text size" disabled={index === 0} onClick={() => onChange(SIZES[index - 1])}>A−</button>
    <button type="button" className="small" aria-label="Reset reading text size" title="Reset reading size" onClick={() => onChange(100)}>{size}%</button>
    <button type="button" className="small" aria-label="Increase reading text size" disabled={index === SIZES.length - 1} onClick={() => onChange(SIZES[index + 1])}>A+</button>
  </div>;
}
export function NoteContent({ doc, size }: { doc: unknown; size: number }) {
  return <div className="note-rich" style={{ fontSize: `${size / 100}em` }} dangerouslySetInnerHTML={{ __html: noteHtml(scaleNoteText(doc as JSONContent, size / 100)) }} />;
}
