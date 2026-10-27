/**
 * Markdown in, Tiptap document out (and back). Covers what notes and stems use: headings,
 * paragraphs with line breaks, bullet and numbered lists, bold and italic, and pipe tables.
 */
export interface DocNode { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string; marks?: { type: string }[] }

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function inline(text: string): DocNode[] {
  const out: DocNode[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ type: "text", text: m[2], marks: [{ type: "bold" }] });
    else out.push({ type: "text", text: m[4], marks: [{ type: "italic" }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.filter((n) => n.text);
}

/** A paragraph whose single newlines become line breaks. */
function paragraph(lines: string[]): DocNode {
  const content: DocNode[] = [];
  lines.forEach((line, i) => { if (i) content.push({ type: "hardBreak" }); content.push(...inline(line)); });
  return { type: "paragraph", content: content.length ? content : undefined };
}

const cells = (row: string): string[] => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function markdownToDoc(markdown: string): DocNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content: DocNode[] = [];
  let i = 0;
  const flushParagraph = (buf: string[]) => { if (buf.length) content.push(paragraph(buf)); };
  let buf: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flushParagraph(buf); buf = []; i++; continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(buf); buf = []; content.push({ type: "heading", attrs: { level: heading[1].length }, content: inline(heading[2].trim()) }); i++; continue; }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushParagraph(buf); buf = [];
      const header = cells(line);
      const rows: DocNode[] = [{ type: "tableRow", content: header.map((c) => ({ type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [paragraph([c])] })) }];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        const row = cells(lines[i]);
        rows.push({ type: "tableRow", content: header.map((_, k) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [paragraph([row[k] ?? ""])] })) });
        i++;
      }
      content.push({ type: "table", content: rows });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph(buf); buf = [];
      const ordered = !!numbered;
      const items: DocNode[] = [];
      const start = numbered ? Number(numbered[1]) : 1;
      while (i < lines.length) {
        const b = /^\s*[-*•]\s+(.+)$/.exec(lines[i]); const n = /^\s*(\d+)[.)]\s+(.+)$/.exec(lines[i]);
        if (ordered ? !n : !b) break;
        items.push({ type: "listItem", content: [paragraph([(ordered ? n![2] : b![1]).trim()])] });
        i++;
      }
      content.push(ordered ? { type: "orderedList", attrs: { start }, content: items } : { type: "bulletList", content: items });
      continue;
    }
    buf.push(line.trim());
    i++;
  }
  flushParagraph(buf);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Plain text of a document: the searchable copy the site keeps beside every document. */
export function docToText(node: DocNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content ?? []).map(docToText);
  switch (node.type) {
    case "doc": return inner.join("\n").trim();
    case "tableRow": return inner.join(" | ");
    case "table": return inner.join("\n");
    case "bulletList": case "orderedList": return inner.join("\n");
    case "listItem": return `- ${inner.join("\n")}`;
    default: return inner.join("");
  }
}

function inlineMarkdown(nodes: DocNode[] | undefined): string {
  return (nodes ?? []).map((n) => {
    if (n.type === "hardBreak") return "\n";
    if (n.type !== "text") return docToMarkdown(n);
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    let t = n.text ?? "";
    if (marks.has("bold")) t = `**${t}**`;
    if (marks.has("italic")) t = `*${t}*`;
    return t;
  }).join("");
}

/** Markdown of a document, for reading a note or stem in the chat. */
export function docToMarkdown(node: DocNode | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "doc": return (node.content ?? []).map(docToMarkdown).filter(Boolean).join("\n\n").trim();
    case "heading": return `${"#".repeat(Number(node.attrs?.level ?? 1))} ${inlineMarkdown(node.content)}`;
    case "paragraph": return inlineMarkdown(node.content);
    case "bulletList": return (node.content ?? []).map((li) => `- ${(li.content ?? []).map(docToMarkdown).join("\n  ")}`).join("\n");
    case "orderedList": return (node.content ?? []).map((li, i) => `${Number(node.attrs?.start ?? 1) + i}. ${(li.content ?? []).map(docToMarkdown).join("\n   ")}`).join("\n");
    case "table": {
      const rows = (node.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map(docToMarkdown).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")));
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, k) => r[k] ?? "").join(" | ")} |`;
      return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
    }
    case "image": return node.attrs?.src ? `[picture]` : "";
    case "text": return inlineMarkdown([node]);
    default: return (node.content ?? []).map(docToMarkdown).join("\n");
  }
}

/** Whether text needs a document rather than plain text: a table, heading, list or emphasis. */
export function looksRich(text: string): boolean {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines.some((l, i) => TABLE_ROW.test(l) && TABLE_SEP.test(lines[i + 1] ?? "")) || /^#{1,3}\s|\*\*.+\*\*/m.test(text) || /^\s*(?:[-*•]|\d+[.)])\s+/m.test(text) && lines.filter((l) => l.trim()).length > 1;
}
