import { db, getSettings, patchSettings } from "../data/db";
import type { CloudUser } from "./firebase";
import { loadSession, switchSessionAccount } from "./session";

export function belongsToAccount(record: { ownerId?: string }, ownerId: string): boolean {
  return (record.ownerId ?? "") === ownerId;
}

let changing: Promise<void> = Promise.resolve();
/** Guest work joins the first account used; existing account records never change owner. */
export function setProgressAccount(user: CloudUser | null): Promise<void> {
  const run = changing.catch(() => undefined).then(async () => {
    const previous = (await getSettings()).cloudUser?.uid ?? "";
    const next = user?.uid ?? "";
    if (next) {
      // If both have a paper in progress, keep the guest paper intact for later.
      const guest = loadSession("");
      const retainedGuest = guest && loadSession(next) ? guest : null;
      await db.transaction("rw", db.attempts, db.marks, db.syncDeletes, async () => {
        await db.attempts.filter((a) => !a.ownerId && (!retainedGuest || a.sessionId !== retainedGuest.id)).modify({ ownerId: next });
        await db.marks.filter((m) => !m.ownerId && !retainedGuest?.attemptIds.includes(m.attemptId)).modify({ ownerId: next });
        await db.syncDeletes.filter((d) => !d.ownerId).modify({ ownerId: next });
      });
    }
    switchSessionAccount(previous, next);
    await patchSettings({ cloudUser: user ?? undefined });
  });
  changing = run;
  return run;
}
