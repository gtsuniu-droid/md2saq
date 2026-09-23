import { PRESENTATIONS } from "../data/presentations";
import type { Question, QuestionSet } from "../data/types";
import { dominantPresentation } from "./setGroup";

/** Legacy sets use their named bank/branch before falling back to question tags. */
export function primaryPresentation(set: QuestionSet, questions: Pick<Question, "order" | "presentations">[]): string | undefined {
  if (set.primaryPresentation) return set.primaryPresentation;
  const known = (name: string) => PRESENTATIONS.find((p) => p.id === name || p.name.toLowerCase() === name.replace(/_/g, " ").trim().toLowerCase())?.id;
  for (const tag of set.tags ?? []) {
    if (tag.includes("::")) {
      const id = known(tag.split("::")[0]);
      if (id) return id;
    }
  }
  for (const label of [set.collection, set.name, set.source]) {
    if (!label) continue;
    const prefix = label.split(/\s+[–—]\s+|:|\s+SAQ\b|\s+Bank\b|\s+Set\b/i)[0];
    const id = known(prefix);
    if (id) return id;
  }
  return dominantPresentation([...questions].sort((a, b) => a.order - b.order));
}
