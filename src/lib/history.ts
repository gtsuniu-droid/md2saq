import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { belongsToAccount } from "./progressAccount";
import { setLabel } from "./sets";

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
        label: `${set ? setLabel(set) : attempt.qref?.setNumber !== undefined ? `Set ${String(attempt.qref.setNumber).padStart(2, "0")}` : attempt.qref?.setName || "Question set"}${order !== undefined ? `, Question ${order + 1}` : ""}`,
        text: question?.text || question?.parts[0]?.text || attempt.qref?.text || "Question no longer available on this device.",
      };
    });
}
