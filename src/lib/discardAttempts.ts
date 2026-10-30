import { db } from "../data/db";
import { loadSession, saveSession } from "./session";
import { recordDeletes, requestSync } from "./sync";

/**
 * Throw away a sitting of a set: its attempts and any marks on them go, here and (once
 * synced) in the account, and the set is unattempted again, so it comes round as if never
 * opened. A live session that held these attempts loses them too.
 */
export async function discardAttempts(attemptIds: string[], ownerId?: string): Promise<void> {
  const ids = [...new Set(attemptIds.filter(Boolean))];
  if (!ids.length) return;
  const markIds = (await db.marks.where("attemptId").anyOf(ids).primaryKeys()) as string[];
  await db.transaction("rw", db.attempts, db.marks, async () => {
    if (markIds.length) await db.marks.bulkDelete(markIds);
    await db.attempts.bulkDelete(ids);
  });
  await recordDeletes("attempts", ids);
  if (markIds.length) await recordDeletes("marks", markIds);
  try {
    const s = loadSession(ownerId);
    const gone = new Set(ids);
    if (s && s.attemptIds.some((id) => gone.has(id))) {
      const keep = s.attemptIds.map((id) => !gone.has(id));
      const attempts = s.attemptIds.filter((_, i) => keep[i]);
      if (!attempts.length) saveSession(null, ownerId);
      else {
        // The paper stays on the same question: the index moves back by the questions removed before it.
        const removedBefore = keep.slice(0, s.index).filter((k) => !k).length;
        // A set discarded from among those opened (the current one, or an earlier one) leaves one fewer opened.
        const wasOpened = keep.some((k, i) => !k && i <= s.index);
        saveSession({
          ...s, attemptIds: attempts, questionIds: s.questionIds.filter((_, i) => keep[i]),
          index: Math.max(0, Math.min(s.index - removedBefore, attempts.length - 1)),
          ...(s.openedSetCount && wasOpened ? { openedSetCount: Math.max(1, s.openedSetCount - 1) } : {}),
        }, ownerId);
      }
    }
  } catch { /* no session on this device */ }
  requestSync(0);
}
