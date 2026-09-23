import { db, getSettings } from "../data/db";
import type { AnswerComment } from "../data/types";
import { belongsToAccount } from "./progressAccount";

export type AnswerAnchor = Pick<AnswerComment, "start" | "end" | "quote">;

export function validCommentAnchor(text: string, anchor: AnswerAnchor): boolean {
  return Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.start >= 0 && anchor.end > anchor.start && anchor.end <= text.length && !!anchor.quote.trim() && text.slice(anchor.start, anchor.end) === anchor.quote;
}

/** Splits text without nesting highlights, including overlapping comments. */
export function commentSegments(text: string, comments: AnswerComment[], offset = 0) {
  const boundaries = new Set([0, text.length]);
  for (const c of comments) {
    if (c.end <= offset || c.start >= offset + text.length) continue;
    boundaries.add(Math.max(0, c.start - offset));
    boundaries.add(Math.min(text.length, c.end - offset));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  return sorted.slice(0, -1).map((start, i) => {
    const end = sorted[i + 1];
    return { text: text.slice(start, end), ids: comments.filter((c) => c.start < end + offset && c.end > start + offset).map((c) => c.id) };
  });
}

/** Merge one comment instead of replacing the entire list from a stale page. */
export async function writeAnswerComment(attemptId: string, comment: AnswerComment, expectedUpdatedAt?: number): Promise<void> {
  const owner = (await getSettings()).cloudUser?.uid ?? "";
  if (!comment.id || !comment.text.trim() || !comment.quote.trim() || !Number.isInteger(comment.start) || !Number.isInteger(comment.end) || comment.start < 0 || comment.end <= comment.start) throw new Error("Select some answer text and write a comment.");
  await db.transaction("rw", db.attempts, async () => {
    const attempt = await db.attempts.get(attemptId);
    if (!attempt || !belongsToAccount(attempt, owner) || attempt.submittedAt === undefined) throw new Error("This saved answer is no longer available for this account.");
    if (!attempt.answers.some((a) => a.label === comment.partLabel)) throw new Error("This answer part is no longer available.");
    const comments = attempt.answerComments ?? [];
    const existing = comments.find((c) => c.id === comment.id);
    if (existing?.updatedAt !== expectedUpdatedAt) throw new Error("This comment changed elsewhere. Reopen it before editing.");
    const next = { ...comment, text: comment.text.trim(), createdAt: existing?.createdAt ?? Date.now(), updatedAt: Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1) };
    await db.attempts.update(attemptId, { answerComments: [...comments.filter((c) => c.id !== comment.id), next] });
  });
}

export async function deleteAnswerComment(attemptId: string, id: string, expectedUpdatedAt: number): Promise<void> {
  const owner = (await getSettings()).cloudUser?.uid ?? "";
  await db.transaction("rw", db.attempts, async () => {
    const attempt = await db.attempts.get(attemptId);
    if (!attempt || !belongsToAccount(attempt, owner)) throw new Error("This comment belongs to another account.");
    const comments = attempt.answerComments ?? [];
    const existing = comments.find((c) => c.id === id);
    if (!existing) return;
    if (existing.updatedAt !== expectedUpdatedAt) throw new Error("This comment changed elsewhere. Reopen it before removing it.");
    await db.attempts.update(attemptId, { answerComments: comments.filter((c) => c.id !== id) });
  });
}
