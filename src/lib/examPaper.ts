import type { Question, QuestionSet } from "../data/types";
import { primaryPresentation } from "./primaryPresentation";
import { PRESENTATIONS } from "../data/presentations";

export const EXAM_STEMS = 6;
export const EXAM_READING_SEC = 15 * 60;
export const EXAM_WRITING_SEC = 2 * 60 * 60;

/** Draw presentations first so a large topic bank is not more likely to appear. */
export function examPresentationPool(sets: QuestionSet[], questions: Question[]) {
  const bySet = new Map<string, Question[]>();
  for (const q of questions) bySet.set(q.setId, [...(bySet.get(q.setId) ?? []), q]);
  const pool = new Map<string, Question[][]>();
  for (const set of sets) {
    const members = (bySet.get(set.id) ?? []).sort((a, b) => a.order - b.order);
    if (!members.length) continue;
    const primary = primaryPresentation(set, members);
    if (!primary || !PRESENTATIONS.some((p) => p.id === primary)) continue;
    pool.set(primary, [...(pool.get(primary) ?? []), members]);
  }
  return pool;
}

export function buildExamPaper(sets: QuestionSet[], questions: Question[], random = Math.random): Question[] {
  const pool = examPresentationPool(sets, questions);
  const presentations = [...pool.keys()];
  if (presentations.length < EXAM_STEMS) return [];
  for (let i = presentations.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [presentations[i], presentations[j]] = [presentations[j], presentations[i]];
  }
  return presentations.slice(0, EXAM_STEMS).flatMap((id) => {
    const cases = pool.get(id)!;
    return cases[Math.floor(random() * cases.length)];
  });
}
