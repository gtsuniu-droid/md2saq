import data from "./presentations.json" with { type: "json" };

export interface Presentation { id: string; name: string; synonyms: string[]; parent: string | null }
export const PRESENTATIONS: Presentation[] = data as Presentation[];
const BY_ID = new Map(PRESENTATIONS.map((p) => [p.id, p]));

const simplify = (s: string) => s.toLowerCase().replace(/[—–_-]/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** The site's display name for a presentation id; unknown ids are de-kebabbed. */
export function presentationName(id: string): string {
  return BY_ID.get(id)?.name ?? id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** A presentation from an id, its name, or a synonym such as "hypertension" or "SOB". Null when nothing fits. */
export function resolvePresentation(input: string): Presentation | null {
  const text = simplify(input);
  if (!text) return null;
  const asId = text.replace(/ /g, "-");
  if (BY_ID.has(asId)) return BY_ID.get(asId)!;
  const exact = PRESENTATIONS.find((p) => simplify(p.name) === text || p.synonyms.some((s) => simplify(s) === text));
  if (exact) return exact;
  const byInitials = PRESENTATIONS.filter((p) => simplify(p.name).split(" ").map((x) => x[0]).join("") === text);
  if (byInitials.length === 1) return byInitials[0];
  const starts = PRESENTATIONS.filter((p) => simplify(p.name).startsWith(text) || p.synonyms.some((s) => simplify(s).startsWith(text)));
  return starts.length === 1 ? starts[0] : null;
}

/** Does this free text name the presentation (by name or any synonym)? Used when matching labels like "hypertension 2". */
export function presentationMatches(id: string, words: string): boolean {
  const p = BY_ID.get(id);
  if (!p) return simplify(presentationName(id)).startsWith(words);
  const w = simplify(words);
  const initials = simplify(p.name).split(" ").map((x) => x[0]).join("");
  return simplify(p.name) === w || simplify(p.name).startsWith(w) || w === initials || p.synonyms.some((s) => simplify(s) === w || simplify(s).startsWith(w) || w.startsWith(simplify(s)));
}
