import { db } from "../data/db";
import type { PartAnswer } from "../data/types";

const PREFIX = "saq-answer-draft:";
interface Draft { sessionId: string; answers: PartAnswer[]; savedAt: number }

/** Synchronous recovery copy, written before the debounced IndexedDB save. */
export function writeAnswerDraft(sessionId: string, attemptId: string, answers: PartAnswer[]): void {
  try { localStorage.setItem(PREFIX + attemptId, JSON.stringify({ sessionId, answers, savedAt: Date.now() })); }
  catch { /* IndexedDB autosave remains available if localStorage is full. */ }
}

/** Forget every answer draft on this device. */
export function clearAllAnswerDrafts(): void {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k); } catch { /* storage unavailable */ }
}

export function clearAnswerDraft(attemptId: string, savedAnswers: PartAnswer[]): void {
  try {
    const raw = localStorage.getItem(PREFIX + attemptId);
    if (raw && JSON.stringify((JSON.parse(raw) as Draft).answers) === JSON.stringify(savedAnswers)) {
      localStorage.removeItem(PREFIX + attemptId);
    }
  } catch { /* Keep a recovery copy if it cannot be read. */ }
}

export async function recoverAnswerDrafts(sessionId: string): Promise<void> {
  let keys: string[];
  try { keys = Object.keys(localStorage).filter((key) => key.startsWith(PREFIX)); }
  catch { return; }
  for (const key of keys) {
    let raw: string | null, draft: Draft;
    try {
      raw = localStorage.getItem(key);
      if (!raw) continue;
      draft = JSON.parse(raw);
      if (draft.sessionId !== sessionId || !Array.isArray(draft.answers)) continue;
    } catch { continue; }
    const id = key.slice(PREFIX.length);
    await db.transaction("rw", db.attempts, async () => {
      const attempt = await db.attempts.get(id);
      if (attempt?.sessionId === sessionId && !attempt.submittedAt && draft.savedAt >= (attempt._m ?? 0)) {
        await db.attempts.update(id, { answers: draft.answers });
      }
    });
    // Never erase a newer edit made by another tab during the transaction.
    try { if (localStorage.getItem(key) === raw) localStorage.removeItem(key); } catch { /* retry later */ }
  }
}
