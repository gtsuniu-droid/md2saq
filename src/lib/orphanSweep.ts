import { db } from "../data/db";
import { recordDeletes } from "./sync";

/**
 * Unsubmitted attempts left behind by papers abandoned on this device go, here and (once
 * synced) in the account. Only attempts untouched for a day: the account's paper in progress
 * may belong to another device, and this one runs the sweep only after a sync has brought that
 * paper across, so a live paper is never mistaken for a leftover and its answers deleted.
 */
export const ORPHAN_AGE_MS = 24 * 60 * 60_000;

export async function sweepOrphans(ownerId: string, currentSessionId: string | undefined, now = Date.now()): Promise<string[]> {
  const orphans = (await db.attempts.filter((a) =>
    (a.ownerId ?? "") === ownerId && a.submittedAt === undefined && a.sessionId !== currentSessionId
    && Math.max(a._m ?? 0, a.startedAt) < now - ORPHAN_AGE_MS,
  ).primaryKeys()) as string[];
  if (!orphans.length) return [];
  await db.attempts.bulkDelete(orphans);
  await recordDeletes("attempts", orphans);
  return orphans;
}
