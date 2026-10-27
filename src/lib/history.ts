import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { belongsToAccount } from "./progressAccount";
import { setHeadline } from "./sets";
import { primaryPresentation } from "./primaryPresentation";
import { stemsOf } from "./questions";

export interface HistoryEntry {
  attempt: Attempt;
  mark?: Mark;
  question?: Question;
  set?: QuestionSet;
  label: string;
  text: string;
}

/** Submitted work only: opening a paper pre-creates drafts for every question. */
export function historyEntries(attempts: Attempt[], marks: Mark[], questions: Question[], sets: QuestionSet[], ownerId: string): HistoryEntry[] {
  const byQuestion = new Map(questions.map((q) => [q.id, q]));
  const bySet = new Map(sets.map((s) => [s.id, s]));
  const byAttempt = new Map<string, Mark>();
  for (const mark of marks) {
    if (!belongsToAccount(mark, ownerId)) continue;
    const previous = byAttempt.get(mark.attemptId);
    if (!previous || previous.markedAt < mark.markedAt) byAttempt.set(mark.attemptId, mark);
  }
  return attempts.filter((a) => belongsToAccount(a, ownerId) && a.submittedAt !== undefined)
    .sort((a, b) => b.submittedAt! - a.submittedAt! || b.startedAt - a.startedAt || a.id.localeCompare(b.id))
    .map((attempt) => {
      const question = byQuestion.get(attempt.questionId);
      const set = bySet.get(question?.setId ?? attempt.qref?.setId ?? "");
      const order = question?.order ?? attempt.qref?.order;
      return { attempt, mark: byAttempt.get(attempt.id), question, set,
        label: `${set ? setHeadline(set) : attempt.qref?.setNumber !== undefined ? `Set ${String(attempt.qref.setNumber).padStart(2, "0")}` : attempt.qref?.setName || "Question set"}${order !== undefined ? `, Question ${order + 1}` : ""}`,
        text: question?.text || question?.parts[0]?.text || attempt.qref?.text || "Question no longer available on this device.",
      };
    });
}

export interface HistoryGroup {
  key: string;
  /** A whole set sat in one sitting, or one question on its own. */
  kind: "set" | "question";
  entries: HistoryEntry[];
  /** The attempt whose page shows the whole sitting. */
  anchor: Attempt;
  set?: QuestionSet;
  label: string;
  presentation?: string;
  presentationId?: string;
  text: string;
  submittedAt: number;
  mode: Attempt["mode"];
  marked: number;
  total: number;
  score?: number;
  maxScore?: number;
  reviewLater: boolean;
}

/**
 * One row per sitting: attempts from the same session and set fold into a set row with
 * the total score; a lone question keeps its own row. Newest first.
 */
export function historyGroups(entries: HistoryEntry[], questions: Question[], presentationName: (id: string) => string): HistoryGroup[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const setId = entry.set?.id ?? entry.question?.setId ?? entry.attempt.qref?.setId ?? "";
    const key = entry.attempt.sessionId && setId ? `${entry.attempt.sessionId}:${setId}` : `attempt:${entry.attempt.id}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const bySet = new Map<string, Question[]>();
  for (const q of questions) bySet.set(q.setId, [...(bySet.get(q.setId) ?? []), q]);
  return [...groups.entries()].map(([key, members]): HistoryGroup => {
    const ordered = [...members].sort((a, b) => (a.question?.order ?? a.attempt.qref?.order ?? 0) - (b.question?.order ?? b.attempt.qref?.order ?? 0));
    const first = ordered[0];
    const set = first.set;
    const single = members.length === 1;
    const marked = members.filter((m) => m.mark);
    const presentationId = set ? primaryPresentation(set, bySet.get(set.id) ?? []) : undefined;
    const presentation = presentationId ? presentationName(presentationId) : undefined;
    const setName = set ? setHeadline(set) : first.attempt.qref?.setNumber !== undefined ? `Set ${String(first.attempt.qref.setNumber).padStart(2, "0")}` : first.attempt.qref?.setName || "Question set";
    return {
      key, kind: single ? "question" : "set", entries: ordered, anchor: first.attempt, set, presentation, presentationId,
      label: single ? first.label : presentation ? `${presentation} ${setName}` : setName,
      // The headline already carries the title, so the second line is the case stem; a stale "Set 3" name never shows.
      text: single ? first.text : (first.question && stemsOf(first.question)[0]) || (set?.name && !/^(set|case)\s*\d*$/i.test(set.name.trim()) && !setName.includes(set.name.trim()) ? set.name : "") || first.text,
      submittedAt: Math.max(...members.map((m) => m.attempt.submittedAt ?? 0)),
      mode: first.attempt.mode,
      marked: marked.length, total: members.length,
      score: marked.length === members.length ? marked.reduce((sum, m) => sum + (m.mark?.score ?? 0), 0) : undefined,
      maxScore: marked.length === members.length ? marked.reduce((sum, m) => sum + (m.mark?.maxScore ?? 0), 0) : undefined,
      reviewLater: members.some((m) => m.mark?.reviewLater),
    };
  }).sort((a, b) => b.submittedAt - a.submittedAt || a.key.localeCompare(b.key));
}
