import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../data/db";
import { belongsToAccount } from "./progressAccount";

/**
 * The number of submitted attempts for this account, updating the moment one is submitted
 * anywhere. Counted from the indexes alone, without reading any answers, since it re-runs
 * whenever an attempt is saved, including while an answer is being typed.
 */
export function useSubmittedCount(uid: string | undefined): number {
  return useLiveQuery(() => submittedCount(uid), [uid]) ?? 0;
}

export async function submittedCount(uid: string | undefined): Promise<number> {
  if (uid === undefined) return 0;
  // Guest work has no owner id in the index; count it the slow way.
  if (uid === "") return db.attempts.filter((a) => belongsToAccount(a, uid) && a.submittedAt !== undefined).count();
  return db.attempts.where("[ownerId+submittedAt]").between([uid, Dexie.minKey], [uid, Dexie.maxKey]).count();
}
