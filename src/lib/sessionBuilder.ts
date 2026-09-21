import type { Attempt, Question, QuestionSet } from "../data/types";
import { compileQuestions } from "./stats";
import { totalMarks } from "./questions";
export type StudyUnit = "questions" | "sets";
export interface SessionSet { set: QuestionSet; questions: Question[]; attempted: number }

export function eligibleSessionSets(sets: QuestionSet[], questions: Question[], attempts: Attempt[], presentations: string[], newOnly: boolean, parentOf: Map<string, string>): SessionSet[] {
  const chosen = new Set(presentations);
  const attempted = new Set(attempts.filter((a) => a.submittedAt !== undefined).map((a) => a.questionId));
  const grouped = new Map<string, Question[]>();
  for (const q of questions) grouped.set(q.setId, [...grouped.get(q.setId) ?? [], q]);
  return sets.flatMap((set) => {
    const members = (grouped.get(set.id) ?? []).sort((a, b) => a.order - b.order);
    if (!members.some((q) => q.presentations.some((p) => chosen.has(p) || chosen.has(parentOf.get(p) ?? "")))) return [];
    const done = members.filter((q) => attempted.has(q.id)).length;
    if (newOnly && done > 0) return [];
    return [{ set, questions: members, attempted: done }];
  });
}

export function seededRandom(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}

export function buildSessionSelection(input: {
  unit: StudyUnit; sets: QuestionSet[]; questions: Question[]; attempts: Attempt[]; presentations: string[];
  newOnly: boolean; count?: number; setIds?: string[]; random: () => number; parentOf: Map<string, string>;
}): Question[] {
  if (input.count !== undefined && (!Number.isInteger(input.count) || input.count <= 0)) return [];
  if (input.unit === "questions") return compileQuestions(input.questions, input.attempts, input.presentations, input);
  let pool = eligibleSessionSets(input.sets, input.questions, input.attempts, input.presentations, input.newOnly, input.parentOf);
  if (input.setIds !== undefined) {
    const selected = new Set(input.setIds);
    pool = pool.filter((s) => selected.has(s.set.id));
  } else {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(input.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (input.count !== undefined) pool = pool.slice(0, input.count);
  }
  return pool.flatMap((s) => s.questions);
}

export function suggestedSessionMinutes(questions: Question[], sets: QuestionSet[], minutesPerMark: number, unit: StudyUnit): number {
  const groups = new Map<string, Question[]>();
  for (const q of questions) groups.set(q.setId, [...groups.get(q.setId) ?? [], q]);
  return Math.max(1, Math.round([...groups].reduce((sum, [id, members]) => {
    const suggested = unit === "sets" ? sets.find((s) => s.id === id)?.suggestedMinutes : undefined;
    return sum + (suggested && suggested > 0 ? suggested : members.reduce((n, q) => n + (totalMarks(q) ?? 4) * minutesPerMark, 0));
  }, 0)));
}
