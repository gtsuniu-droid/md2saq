import { loadLibrary } from "./library";
import { belongsToAccount } from "./progressAccount";
import { db, getSettings } from "../data/db";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { totalMarks } from "./questions";
import { startSession } from "./session";
import { nextNumberIn, numberingGroup, rankedPresentations, setNumberLabel } from "./setGroup";

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
  contentReady?: boolean;
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
      return {
        set,
        questions: qs,
        marks: qs.reduce((acc, q) => acc + (totalMarks(q) ?? 0), 0),
        sittings: sittingsFor(qs, attempts, marks),
        attemptedQuestions: qs.filter((q) => attemptedQ.has(q.id)).length,
        markedQuestions: qs.filter((q) => markedQ.has(q.id)).length,
        presentations: rankedPresentations(qs),
      };
    })
    .sort((a, b) => b.set.createdAt - a.set.createdAt);
}

export async function loadSummaries(): Promise<SetSummary[]> {
  const [{ sets, questions, pending }, attempts, marks] = await Promise.all([
    loadLibrary(),
    db.attempts.toArray(),
    db.marks.toArray(),
  ]);
  const ownerId = (await getSettings()).cloudUser?.uid ?? "";
  return summarise(sets, questions, attempts.filter((a) => belongsToAccount(a, ownerId)), marks.filter((m) => belongsToAccount(m, ownerId))).map(summary => ({ ...summary, contentReady: !pending.has(summary.set.id) }));
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
    "sets",
  );
}

/** How a set is referred to everywhere: "Set 01", or its name until it has a number. */
/** "Set 03", or the set's own name when it was never numbered. Short, stable, and what students say aloud. */
export function setLabel(set: Pick<QuestionSet, "number" | "name">): string {
  return set.number !== undefined ? setNumberLabel(set.number) : set.name || "Set";
}

/** A title cut at a word boundary so it fits a list row. */
export function shortTitle(title: string, max = 48): string {
  const t = title.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.5 ? cut.slice(0, at) : t.slice(0, max)).replace(/[,;:.\-–—]+$/, "")}…`;
}

/**
 * The number with a short reminder of the case: "Set 03: Breathless after a long flight".
 * Lists use this so a number means something; the set page shows the full title.
 */
export function setHeadline(set: Pick<QuestionSet, "number" | "name" | "source">, max = 48): string {
  const title = setTitle(set);
  return title ? `${setLabel(set)}: ${shortTitle(title, max)}` : setLabel(set);
}

/** Every set on the device with the group it is numbered in. */
async function groupedSets(): Promise<{ set: QuestionSet; group: string; number?: number }[]> {
  const { sets, questions } = await loadLibrary();
  const bySet = new Map<string, Question[]>();
  for (const q of questions) bySet.set(q.setId, [...(bySet.get(q.setId) ?? []), q]);
  return sets.map((set) => ({ set, group: numberingGroup(set.tags, bySet.get(set.id) ?? [], set.primaryPresentation), number: set.number }));
}

/** Next provisional number on this device for a set in this group: one above the highest known there. */
export async function nextSetNumber(group: string): Promise<number> {
  return nextNumberIn(group, await groupedSets());
}

/**
 * Numbering is automatic. Published sets carry the number the server gave
 * them (1..n within their presentation); sets not yet published follow on
 * after those, in creation order, so the list never shows a gap or a clash.
 * A name that was only ever "Set N" follows the number.
 */
export async function numberUnnumberedSets(): Promise<void> {
  const all = await groupedSets();
  const groups = new Set(all.map((x) => x.group));
  for (const group of groups) {
    const members = all.filter((x) => x.group === group);
    const published = members.filter((x) => x.set.bankId && x.number !== undefined).map((x) => x.number!);
    let next = Math.max(0, ...published);
    const locals = members.filter((x) => !x.set.bankId).sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.set.createdAt - b.set.createdAt);
    for (const x of locals) {
      next++;
      if (x.number !== next) await db.sets.update(x.set.id, { number: next });
      x.number = next;
    }
    for (const x of members) {
      if (x.number === undefined || !/^set\s*\d+$/i.test(x.set.name) || x.set.name === setNumberLabel(x.number)) continue;
      await db.sets.update(x.set.id, { name: setNumberLabel(x.number) });
    }
  }
}

/** Strip bookkeeping prefixes such as "Case 02:" or "Set 3 -" that generators put in front of a title. */
export function cleanTitle(text: string | undefined): string {
  return (text ?? "").replace(/^\s*(?:case|set|station|scenario)\s*\d*\s*[:.\-–—]?\s*/i, "").trim();
}

/** The case title students see: the source title, else a non-generic name. Empty when there is nothing descriptive. */
export function setTitle(set: Pick<QuestionSet, "name" | "source" | "number">): string {
  const fromSource = cleanTitle(set.source);
  if (fromSource) return fromSource;
  const generic = /^(set|case)\s*\d*$/i.test(set.name.trim()) || set.name.trim() === setLabel(set);
  return generic ? "" : cleanTitle(set.name);
}
