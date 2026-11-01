import type { Attempt, Question, QuestionSet, Settings } from "../data/types";
import { getSettings, patchSettings } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import { primaryPresentation } from "./primaryPresentation";

/**
 * What counts as done can be reset without touching History: a reset records a time, and a
 * set whose last sitting was before it is unattempted again. One time covers every set; a
 * presentation can have its own, and the later of the two applies to its sets.
 */
export type ProgressResets = Pick<Settings, "progressResetAt" | "presentationResetAt">;

/** When progress was last reset for sets of this presentation (0 when never). */
export function resetAtFor(resets: ProgressResets, presentationId: string | undefined): number {
  return Math.max(resets.progressResetAt ?? 0, presentationId ? resets.presentationResetAt?.[presentationId] ?? 0 : 0);
}

export function hasProgressResets(resets: ProgressResets): boolean {
  return !!resets.progressResetAt || Object.values(resets.presentationResetAt ?? {}).some(Boolean);
}

/**
 * The attempts that still count towards a set being done: those submitted after the last reset
 * covering their set. Unsubmitted attempts pass through untouched. Marks on an attempt that
 * no longer counts should be left out of the same decision; `countingMarks` does that.
 */
export function attemptsSinceReset(attempts: Attempt[], questions: Question[], sets: QuestionSet[], resets: ProgressResets): Attempt[] {
  if (!hasProgressResets(resets)) return attempts;
  const bySet = new Map<string, Question[]>();
  for (const q of questions) bySet.set(q.setId, [...(bySet.get(q.setId) ?? []), q]);
  const setOf = new Map(questions.map((q) => [q.id, q.setId]));
  const resetAtBySet = new Map<string, number>();
  for (const set of sets) resetAtBySet.set(set.id, resetAtFor(resets, primaryPresentation(set, bySet.get(set.id) ?? [])));
  const fallback = resets.progressResetAt ?? 0;
  return attempts.filter((a) => a.submittedAt === undefined || a.submittedAt > (resetAtBySet.get(setOf.get(a.questionId) ?? a.qref?.setId ?? "") ?? fallback));
}

/** Marks whose attempt still counts. */
export function countingMarks<M extends { attemptId: string }>(marks: M[], counting: Attempt[]): M[] {
  const ids = new Set(counting.map((a) => a.id));
  return marks.filter((m) => ids.has(m.attemptId));
}

/** Two devices' resets combined: each time is the later of the two. */
export function mergeProgressResets(a: ProgressResets, b: ProgressResets): ProgressResets {
  const out: ProgressResets = {};
  const all = Math.max(a.progressResetAt ?? 0, b.progressResetAt ?? 0);
  if (all) out.progressResetAt = all;
  const ids = new Set([...Object.keys(a.presentationResetAt ?? {}), ...Object.keys(b.presentationResetAt ?? {})]);
  const per: Record<string, number> = {};
  for (const id of ids) {
    const at = Math.max(a.presentationResetAt?.[id] ?? 0, b.presentationResetAt?.[id] ?? 0);
    // A presentation's own time that an all-sets reset has since overtaken says nothing more.
    if (at > all) per[id] = at;
  }
  if (Object.keys(per).length) out.presentationResetAt = per;
  return out;
}

export function sameProgressResets(a: ProgressResets, b: ProgressResets): boolean {
  if ((a.progressResetAt ?? 0) !== (b.progressResetAt ?? 0)) return false;
  const pa = a.presentationResetAt ?? {}, pb = b.presentationResetAt ?? {};
  const ids = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  return [...ids].every((id) => (pa[id] ?? 0) === (pb[id] ?? 0));
}

/**
 * Reset progress now: for every set, or for the presentations given (and their children). The
 * time goes into settings, so it follows the account; callers ask for a sync afterwards.
 */
export async function resetProgress(presentationIds?: string[], now = Date.now()): Promise<void> {
  if (!presentationIds) {
    await patchSettings({ progressResetAt: now, presentationResetAt: undefined });
    return;
  }
  const per = { ...((await getSettings()).presentationResetAt ?? {}) };
  for (const id of presentationIds) {
    per[id] = now;
    for (const child of PRESENTATIONS) if (child.parent === id) per[child.id] = now;
  }
  await patchSettings({ presentationResetAt: per });
}
