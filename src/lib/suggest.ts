import { PRESENTATIONS } from "../data/presentations";

/** Presentation ids whose synonyms appear in the text, best match first. */
export function suggestPresentations(text: string, limit = 3): string[] {
  const hay = " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  const scored: { id: string; score: number }[] = [];
  for (const p of PRESENTATIONS) {
    let score = 0;
    for (const syn of p.synonyms) {
      const needle = " " + syn.replace(/[^a-z0-9]+/g, " ") + " ";
      let from = 0;
      let at: number;
      while ((at = hay.indexOf(needle, from)) !== -1) {
        score += syn.length;
        from = at + needle.length - 1;
      }
    }
    if (score > 0) scored.push({ id: p.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.id);
}
