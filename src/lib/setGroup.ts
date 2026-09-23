import { PRESENTATIONS } from "../data/presentations";

/**
 * Set numbers count from 1 within a presentation, so a set is "Dizziness –
 * Set 01" and the next presentation starts again at Set 01. The group a set
 * is numbered in is the top segment of its first "::" tag when it has one,
 * otherwise its dominant presentation. Shared by the server (which hands out
 * the numbers) and the app (which numbers unpublished sets the same way).
 */

/** The presentation most of a set's questions carry, ties going to the first seen. */
export function dominantPresentation(questions: { presentations?: string[] }[]): string | undefined {
  const counts = new Map<string, number>();
  for (const q of questions) for (const p of q.presentations ?? []) counts.set(p, (counts.get(p) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [p, n] of counts) {
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return best;
}

/** Presentations of a set, most frequent first. */
export function rankedPresentations(questions: { presentations?: string[] }[]): string[] {
  const counts = new Map<string, number>();
  for (const q of questions) for (const p of q.presentations ?? []) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

/** The key sets are numbered within: a presentation id, or a lowercased custom branch name. */
export function numberingGroup(tags: string[] | undefined, questions: { presentations?: string[] }[], primary?: string): string {
  if (primary) return primary;
  const nested = (tags ?? []).find((t) => t.includes("::"));
  if (nested) {
    const top = nested.split("::")[0].replace(/_/g, " ").trim();
    const known = PRESENTATIONS.find((p) => p.name.toLowerCase() === top.toLowerCase());
    return known ? known.id : top.toLowerCase();
  }
  return dominantPresentation(questions) ?? "untagged";
}

/** One above the highest number already used in the group. */
export function nextNumberIn(group: string, taken: { group: string; number?: number }[]): number {
  return taken.reduce((m, e) => (e.group === group ? Math.max(m, e.number ?? 0) : m), 0) + 1;
}

/** "Set 01": numbers are shown with two digits, as in an Anki tag. */
export function setNumberLabel(n: number): string {
  return `Set ${String(n).padStart(2, "0")}`;
}
