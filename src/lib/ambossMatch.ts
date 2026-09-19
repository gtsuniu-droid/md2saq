/**
 * Term matching, copied from the add-on's PhraseMarker but applied to a text
 * model instead of the DOM: longest term first, case-insensitive, punctuation
 * boundaries, no term inside an already matched span.
 */
export interface Term {
  term: string;
  pgId: string;
}

export type Segment = { text: string; term?: string; pgId?: string };

const BOUNDARY_BEFORE = "(?<=[\\s,.:;\"'?!\\[\\(/]|^)";
const BOUNDARY_AFTER = "(?=[\\s,.:;\"'?!\\]\\)/]|$)";

let lookbehindSupported: boolean | null = null;
function hasLookbehind(): boolean {
  if (lookbehindSupported === null) {
    try {
      new RegExp("(?<=a)b");
      lookbehindSupported = true;
    } catch {
      lookbehindSupported = false;
    }
  }
  return lookbehindSupported;
}

export function termRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ \\u2010\\u2011\\u2212-]");
  const before = hasLookbehind() ? BOUNDARY_BEFORE : "\\b";
  return new RegExp(before + escaped + BOUNDARY_AFTER, "gmi");
}

export function markTerms(text: string, terms: Term[]): Segment[] {
  if (!text || terms.length === 0) return [{ text }];
  const ordered = [...terms].filter((t) => t.term.trim()).sort((a, b) => b.term.length - a.term.length);
  const taken: { start: number; end: number; term: Term }[] = [];
  const overlaps = (s: number, e: number) => taken.some((r) => s < r.end && e > r.start);
  for (const t of ordered) {
    const re = termRegex(t.term);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (!overlaps(start, end)) taken.push({ start, end, term: t });
    }
  }
  taken.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const r of taken) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start) });
    out.push({ text: text.slice(r.start, r.end), term: r.term.term, pgId: r.term.pgId });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}
