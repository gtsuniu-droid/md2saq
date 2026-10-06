import { isAdmin } from "./admin";
import { db, getSettings } from "../data/db";
import { loadSession, saveSession } from "./session";
import { recordDeletes } from "./sync";

/**
 * Remove one question from its set: the question, every attempt and mark on
 * it, and its place in the paper in progress. The remaining questions close
 * the gap in their numbering and the set is marked as edited so the next
 * publish carries the change.
 */
export async function deleteQuestion(questionId: string): Promise<{ setId: string; remaining: number } | null> {
  if (!isAdmin(await getSettings())) throw new Error("Only an admin can delete questions.");
  const q = await db.questions.get(questionId);
  if (!q) return null;
  const goneAttempts = (await db.attempts.where("questionId").equals(questionId).primaryKeys()) as string[];
  const goneMarks = (await db.marks.where("questionId").equals(questionId).primaryKeys()) as string[];
  let remaining = 0;
  await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
    await db.marks.bulkDelete(goneMarks);
    await db.attempts.bulkDelete(goneAttempts);
    await db.questions.delete(questionId);
    const rest = (await db.questions.where("setId").equals(q.setId).toArray()).sort((a, b) => a.order - b.order);
    remaining = rest.length;
    await db.questions.bulkPut(rest.map((x, i) => ({ ...x, order: i })));
    await db.sets.update(q.setId, { updatedAt: Date.now(), dirty: true });
  });
  await recordDeletes("attempts", goneAttempts);
  await recordDeletes("marks", goneMarks);
  saveSession(sessionWithout(loadSession(), questionId));
  return { setId: q.setId, remaining };
}

/** The session with one question taken out, or null when nothing is left. */
export function sessionWithout<S extends { questionIds: string[]; attemptIds: string[]; index: number }>(s: S | null, questionId: string): S | null {
  if (!s) return null;
  const i = s.questionIds.indexOf(questionId);
  if (i < 0) return s;
  const questionIds = s.questionIds.filter((_, x) => x !== i);
  if (questionIds.length === 0) return null;
  return {
    ...s,
    questionIds,
    attemptIds: s.attemptIds.filter((_, x) => x !== i),
    index: Math.min(s.index > i ? s.index - 1 : s.index, questionIds.length - 1),
  };
}
