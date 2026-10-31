import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { buildSetForMarking, type MarkingQuestion, type SetForMarking } from "./setForMarking";
import { setHeadline } from "./sets";

/**
 * An exam paper laid out for marking as one piece: every set of the sitting in the order sat,
 * the questions numbered right through, each set named where it begins and its marking notes
 * gathered at the end. It travels the same way as a set (copied as text, or kept in the
 * student's store for their assistant), and marks sent back for it carry each part's own
 * attempt, so every set's marking page picks up its share.
 */
export interface MarkingRow { question?: Question; attempt?: Attempt; order: number }
export interface ExamSet { setId: string; set?: QuestionSet; name: string; rows: MarkingRow[] }

/** The store key of a sitting's whole paper, apart from its sets' keys (their anchor attempts). */
export const examKey = (sessionId: string): string => `exam:${sessionId}`;

export const examName = (at: number): string => `Exam, ${new Date(at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;

/**
 * The sets of a sitting: in the session's own order when it is known, else by when each attempt
 * was started; within a set, the questions in set order.
 */
export function examSets(attempts: Attempt[], questions: Question[], sets: QuestionSet[], order?: string[]): ExamSet[] {
  const byQuestion = new Map(questions.map((q) => [q.id, q]));
  const bySet = new Map(sets.map((s) => [s.id, s]));
  const orderOf = (a: Attempt) => byQuestion.get(a.questionId)?.order ?? a.qref?.order ?? 0;
  const rank = (a: Attempt) => { const i = order?.indexOf(a.id) ?? -1; return i >= 0 ? i : Number.MAX_SAFE_INTEGER; };
  const sorted = [...attempts].sort((a, b) => rank(a) - rank(b) || a.startedAt - b.startedAt || orderOf(a) - orderOf(b));
  const groups = new Map<string, ExamSet>();
  for (const attempt of sorted) {
    const question = byQuestion.get(attempt.questionId);
    const setId = question?.setId ?? attempt.qref?.setId ?? attempt.id;
    const set = bySet.get(setId);
    const group = groups.get(setId) ?? { setId, set, name: set ? setHeadline(set) : attempt.qref?.setName || "Set", rows: [] };
    group.rows.push({ question, attempt, order: orderOf(attempt) });
    groups.set(setId, group);
  }
  return [...groups.values()].map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => a.order - b.order) }));
}

/** The paper's score so far: the newest saved mark on each of its attempts, over those that have one. */
export function paperScore(attempts: Attempt[], marks: Mark[]): { score: number; maxScore: number; marked: number; total: number } {
  const ids = new Set(attempts.map((a) => a.id));
  const latest = new Map<string, Mark>();
  for (const m of marks) if (ids.has(m.attemptId) && (latest.get(m.attemptId)?.markedAt ?? -1) <= m.markedAt) latest.set(m.attemptId, m);
  let score = 0, maxScore = 0;
  for (const m of latest.values()) { score += m.score; maxScore += m.maxScore; }
  return { score, maxScore, marked: latest.size, total: attempts.length };
}

/** The paper as one set for marking: only submitted questions, numbered 1 onwards across the sets. */
export function buildExamForMarking(key: string, groups: ExamSet[]): SetForMarking {
  const questions: MarkingQuestion[] = [];
  const notes: string[] = [];
  let at = 0;
  for (const g of groups) {
    const rows = g.rows.filter((r) => r.question && r.attempt?.submittedAt !== undefined).map((r, i) => ({ ...r, order: questions.length + i }));
    const built = buildSetForMarking(g.setId, g.name, rows, g.set);
    if (!built.questions.length) continue;
    built.questions[0].section = g.name;
    questions.push(...built.questions);
    if (built.notes) notes.push(`${g.name}: ${built.notes}`);
    at = Math.max(at, built.at);
  }
  return { key, name: examName(at), at, exam: true, ...(notes.length ? { notes: notes.join("\n\n") } : {}), questions };
}
