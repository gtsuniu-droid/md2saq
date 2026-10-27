import { expect, it } from "vitest";
import { docToMarkdown, docToText, looksRich, markdownToDoc } from "../../mcp/src/markdownDoc";

it("round-trips headings, lists, emphasis and a table", () => {
  const md = "# Causes\n\nMost are **benign**. Think of *three* groups.\n\n- Vascular\n- Infective\n\n1. First\n2. Second\n\n| Feature | Vestibular neuritis | BPPV |\n| --- | --- | --- |\n| Duration | Days | Seconds |\n| Hearing | Normal | Normal |";
  const doc = markdownToDoc(md);
  expect(doc.content?.map((n) => n.type)).toEqual(["heading", "paragraph", "bulletList", "orderedList", "table"]);
  const table = doc.content![4];
  expect(table.content).toHaveLength(3);
  expect(table.content![0].content![0].type).toBe("tableHeader");
  expect(table.content![1].content![2].content![0].content![0].text).toBe("Seconds");
  expect(docToMarkdown(doc)).toBe(md);
  expect(docToText(doc)).toContain("Feature | Vestibular neuritis | BPPV");
});

it("keeps single line breaks inside a paragraph and treats plain prose as plain", () => {
  const doc = markdownToDoc("Line one\nline two");
  expect(doc.content![0].content!.map((n) => n.type)).toEqual(["text", "hardBreak", "text"]);
  expect(looksRich("State the diagnosis.")).toBe(false);
  expect(looksRich("- one point\n- another")).toBe(true);
  expect(looksRich("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
});
