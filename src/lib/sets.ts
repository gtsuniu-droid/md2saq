import { db } from "../data/db";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { totalMarks } from "./questions";
import { startSession } from "./session";

export interface Sitting {
  sessionId: string;
  mode: "practice" | "exam";
  startedAt: number;
  submittedAt: number;
  answered: number;
  marked: number;
  score: number;
  maxScore: number;
}

export interface SetSummary {
  set: QuestionSet;
  questions: Question[];
  marks: number;
  sittings: Sitting[];
  /** Questions with at least one submitted attempt. */
  attemptedQuestions: number;
  /** Questions whose latest attempt is marked. */
  markedQuestions: number;
  /** Presentations across the set's questions, most frequent first. */
  presentations: string[];
}

/** Group submitted attempts of a set's questions into sittings (one per session). */
export function sittingsFor(questions: Question[], attempts: Attempt[], marks: Mark[]): Sitting[] {
  const qids = new Set(questions.map((q) => q.id));
  const markByAttempt = new Map(marks.map((m) => [m.attemptId, m]));
  const bySession = new Map<string, Sitting>();
  for (const a of attempts) {
    if (!qids.has(a.questionId) || a.submittedAt === undefined) continue;
    const key = a.sessionId ?? a.id;
    const s = bySession.get(key) ?? {
      sessionId: key,
      mode: a.mode,
      startedAt: a.startedAt,
      submittedAt: 0,
      answered: 0,
      marked: 0,
      score: 0,
      maxScore: 0,
    };
    s.answered++;
    s.startedAt = Math.min(s.startedAt, a.startedAt);
    s.submittedAt = Math.max(s.submittedAt, a.submittedAt);
    const m = markByAttempt.get(a.id);
    if (m) {
      s.marked++;
      s.score += m.score;
      s.maxScore += m.maxScore;
    }
    bySession.set(key, s);
  }
  return [...bySession.values()].sort((a, b) => b.submittedAt - a.submittedAt);
}

export function summarise(sets: QuestionSet[], questions: Question[], attempts: Attempt[], marks: Mark[]): SetSummary[] {
  const attemptedQ = new Set(attempts.filter((a) => a.submittedAt !== undefined).map((a) => a.questionId));
  const markedQ = new Set(marks.map((m) => m.questionId));
  const byId = new Map<string, Question[]>();
  for (const q of questions) {
    const list = byId.get(q.setId) ?? [];
    list.push(q);
    byId.set(q.setId, list);
  }
  return sets
    .map((set) => {
      const qs = (byId.get(set.id) ?? []).sort((a, b) => a.order - b.order);
      const counts = new Map<string, number>();
      for (const q of qs) for (const p of q.presentations) counts.set(p, (counts.get(p) ?? 0) + 1);
      return {
        set,
        questions: qs,
        marks: qs.reduce((acc, q) => acc + (totalMarks(q) ?? 0), 0),
        sittings: sittingsFor(qs, attempts, marks),
        attemptedQuestions: qs.filter((q) => attemptedQ.has(q.id)).length,
        markedQuestions: qs.filter((q) => markedQ.has(q.id)).length,
        presentations: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p),
      };
    })
    .sort((a, b) => b.set.createdAt - a.set.createdAt);
}

export async function loadSummaries(): Promise<SetSummary[]> {
  const [sets, questions, attempts, marks] = await Promise.all([
    db.sets.toArray(),
    db.questions.toArray(),
    db.attempts.toArray(),
    db.marks.toArray(),
  ]);
  return summarise(sets, questions, attempts, marks);
}

/** Default timer for a set: the paper's own suggestion, else marks times minutes per mark. */
export function suggestedMinutesFor(summary: SetSummary, minutesPerMark: number): number {
  if (summary.set.suggestedMinutes) return summary.set.suggestedMinutes;
  const marks = summary.questions.reduce((acc, q) => acc + (totalMarks(q) ?? 4), 0);
  return Math.max(1, Math.round(marks * minutesPerMark));
}

export function startSet(summary: SetSummary, mode: "practice" | "exam", minutes: number | undefined): void {
  startSession(
    summary.questions.map((q) => q.id),
    mode,
    minutes && minutes > 0 ? Math.round(minutes * 60) : undefined,
  );
}

/** How a set is referred to everywhere: its number, or its name until it has one. */
export function setLabel(set: QuestionSet): string {
  return set.number !== undefined ? `Set ${set.number}` : set.name || "Set";
}

/** Next provisional number on this device: one above the highest known. */
export async function nextSetNumber(): Promise<number> {
  const sets = await db.sets.toArray();
  return sets.reduce((m, s) => Math.max(m, s.number ?? 0), 0) + 1;
}

/**
 * Give numbers to sets that predate numbering, oldest first, and move any
 * local-only set whose provisional number now clashes with a bank number.
 */
export async function numberUnnumberedSets(): Promise<void> {
  const sets = await db.sets.toArray();
  let n = sets.reduce((m, s) => Math.max(m, s.number ?? 0), 0);
  const missing = sets.filter((s) => s.number === undefined).sort((a, b) => a.createdAt - b.createdAt);
  for (const s of missing) {
    s.number = ++n;
    await db.sets.update(s.id, { number: s.number });
  }
  const taken = new Set(sets.filter((s) => s.bankId && s.number !== undefined).map((s) => s.number));
  for (const s of sets) {
    if (s.bankId || s.number === undefined || !taken.has(s.number)) continue;
    s.number = ++n;
    await db.sets.update(s.id, { number: s.number });
  }
}
