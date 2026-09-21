import type { JSONContent } from "@tiptap/react";

/** Enlarge explicit text sizes for reading without altering stored content or images. */
export function scaleNoteText(doc: JSONContent, scale: number): JSONContent {
  if (scale === 1) return doc;
  return {
    ...doc,
    ...(doc.content && { content: doc.content.map((node) => scaleNoteText(node, scale)) }),
    ...(doc.marks && { marks: doc.marks.map((mark) => {
      const size = mark.type === "textStyle" && mark.attrs?.fontSize;
      const match = typeof size === "string" && /^(\d+(?:\.\d+)?)(px|pt|pc|in|cm|mm|q)$/i.exec(size);
      return match ? { ...mark, attrs: { ...mark.attrs, fontSize: `${Number(match[1]) * scale}${match[2]}` } } : mark;
    }) }),
  };
}
