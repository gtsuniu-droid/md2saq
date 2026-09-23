import { db, getSettings } from "../data/db";
import type { Mark } from "../data/types";
import { belongsToAccount } from "./progressAccount";

/** Commit score, personal notes and reminder together, without crossing accounts. */
export async function saveMarking(mark: Mark, confidence?: number): Promise<void> {
  const owner = (await getSettings()).cloudUser?.uid ?? "";
  if (!belongsToAccount(mark, owner)) throw new Error("Your account changed. Reopen this attempt before saving.");
  if (mark.parts.some((p) => !Number.isFinite(p.score) || !Number.isFinite(p.maxScore) || p.score < 0 || p.maxScore < 0 || p.score > p.maxScore)) throw new Error("Enter a score between zero and the maximum for each part.");
  if (confidence !== undefined && (!Number.isInteger(confidence) || confidence < 1 || confidence > 5)) throw new Error("Choose a confidence rating from 1 to 5.");
  await db.transaction("rw", db.attempts, db.marks, async () => {
    const attempt = await db.attempts.get(mark.attemptId);
    if (!attempt || !belongsToAccount(attempt, owner) || attempt.submittedAt === undefined) throw new Error("This submitted attempt is no longer available.");
    const existing = await db.marks.get(mark.id);
    if (existing && (!belongsToAccount(existing, owner) || existing.attemptId !== attempt.id)) throw new Error("This marking belongs to another attempt.");
    const newlyFlagged = (mark.lookedAtAnswer && !existing?.lookedAtAnswer) || (mark.reviewLater && !existing?.reviewLater);
    const previouslyStrong = !!existing && existing.maxScore > 0 && existing.score / existing.maxScore >= .6;
    const score = mark.parts.reduce((n, p) => n + p.score, 0);
    const maximum = mark.parts.reduce((n, p) => n + p.maxScore, 0);
    const newlyWeak = previouslyStrong && maximum > 0 && score / maximum < .6;
    await db.marks.put({ ...mark, reviewSchedule: newlyFlagged || newlyWeak ? undefined : existing?.reviewSchedule, reviewLater: !!(mark.reviewLater || mark.lookedAtAnswer), ownerId: owner, questionId: attempt.questionId, score: mark.parts.reduce((n, p) => n + p.score, 0), maxScore: mark.parts.reduce((n, p) => n + p.maxScore, 0) });
    await db.attempts.update(attempt.id, { confidence });
  });
}
