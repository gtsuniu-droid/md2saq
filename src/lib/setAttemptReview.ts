import type { Attempt, Mark, Question } from "../data/types";
import { belongsToAccount } from "./progressAccount";

/** Review one sitting of one set, never mixing in answers from a later retry. */
export function setAttemptReview(anchorId: string, attempts: Attempt[], questions: Question[], marks: Mark[], ownerId: string) {
  const anchor = attempts.find((a) => a.id === anchorId && belongsToAccount(a, ownerId));
  if (!anchor) return null;
  const byQuestion = new Map(questions.map((q) => [q.id, q]));
  const setId = byQuestion.get(anchor.questionId)?.setId ?? anchor.qref?.setId;
  const members = attempts.filter((a) => {
    if (!belongsToAccount(a, ownerId)) return false;
    if (anchor.sessionId ? a.sessionId !== anchor.sessionId : a.id !== anchor.id) return false;
    const q = byQuestion.get(a.questionId);
    return a.id === anchor.id || (q ? q.setId === setId : !!anchor.qref?.setId && a.qref?.setId === anchor.qref.setId);
  });
  const saved = new Map<string, Attempt>();
  for (const a of [...members].sort((a, b) => a.startedAt - b.startedAt)) saved.set(a.questionId, a);
  saved.set(anchor.questionId, anchor);
  const byAttempt = new Map<string, Mark>();
  for (const m of marks) {
    if (!belongsToAccount(m, ownerId)) continue;
    if ((byAttempt.get(m.attemptId)?.markedAt ?? -1) <= m.markedAt) byAttempt.set(m.attemptId, m);
  }
  const ids = new Set([...questions.filter((q) => q.setId === setId).map((q) => q.id), ...saved.keys()]);
  const rows = [...ids].map((id) => {
    const question = byQuestion.get(id);
    const attempt = saved.get(id);
    return { question, attempt, mark: attempt ? byAttempt.get(attempt.id) : undefined, order: question?.order ?? attempt?.qref?.order ?? 0 };
  }).sort((a, b) => a.order - b.order);
  return { anchor, setId, rows };
}
