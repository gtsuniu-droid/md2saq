import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { scaleNoteText } from "./noteReading";

describe("reading text size", () => {
  const doc: JSONContent = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Notes", marks: [{ type: "textStyle", attrs: { fontSize: "24px", color: "#7e22ce" } }] }] },
    { type: "image", attrs: { src: "/figure.png", width: 351, height: 241 } },
  ] };
  it("enlarges explicitly sized text without changing the saved note or picture dimensions", () => {
    const original = structuredClone(doc);
    const enlarged = scaleNoteText(doc, 1.5);
    expect(enlarged.content?.[0].content?.[0].marks?.[0].attrs).toEqual({ fontSize: "36px", color: "#7e22ce" });
    expect(enlarged.content?.[1]).toEqual(original.content?.[1]);
    expect(doc).toEqual(original);
  });
  it("leaves relative text sizes to inherit the reader's base size", () => {
    const relative: JSONContent = { type: "text", text: "Heading", marks: [{ type: "textStyle", attrs: { fontSize: "1.5em" } }] };
    expect(scaleNoteText(relative, 2)).toEqual(relative);
  });
  it("keeps legacy notes and returns original formatting at 100%", () => {
    expect(scaleNoteText(doc, 1)).toBe(doc);
    expect(scaleNoteText({ type: "doc", content: [{ type: "paragraph" }] }, 1.5)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});
