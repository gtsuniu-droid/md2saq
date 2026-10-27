import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../data/db";
import { belongsToAccount } from "./progressAccount";

/** The number of submitted attempts for this account, updating the moment one is submitted anywhere. */
export function useSubmittedCount(uid: string | undefined): number {
  return useLiveQuery(async () => (uid === undefined ? 0 : db.attempts.filter((a) => belongsToAccount(a, uid) && a.submittedAt !== undefined).count()), [uid]) ?? 0;
}
