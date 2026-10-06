import type { Question } from "../data/types";
import type { SetPack } from "./exportImport";

/** Ignore local IDs and marking state when matching older imported questions. */
export function sameQuestion(a: Question, b: Question): boolean {
  return JSON.stringify([a.text, a.textDoc ?? null, a.stemDocs ?? [], a.stems ?? [], a.parts.map(p => [p.label, p.text, p.textDoc ?? null]), a.images ?? []])
    === JSON.stringify([b.text, b.textDoc ?? null, b.stemDocs ?? [], b.stems ?? [], b.parts.map(p => [p.label, p.text, p.textDoc ?? null]), b.images ?? []]);
}

export function publishedQuestion(pack: SetPack, local: Question): Question | undefined {
  const id = local.bankQuestionId ?? local.id;
  const exact = pack.questions.find(q => q.id === id);
  if (exact) return exact;
  // Legacy imports may have remapped IDs. Never guess using a mutable position.
  if (local.bankQuestionId) return undefined;
  const matches = pack.questions.filter(q => sameQuestion(q, local));
  return matches.length === 1 ? matches[0] : undefined;
}

