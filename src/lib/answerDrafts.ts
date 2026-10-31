import { db } from "../data/db";
import type { PartAnswer } from "../data/types";

const PREFIX = "saq-answer-draft:";
/** What stands in for a picture in the recovery copy: a short fingerprint of its data. */
const PICTURE = "draft:";
interface Draft { sessionId: string; answers: PartAnswer[]; savedAt: number }

/** FNV-1a, 32 bits, as hex: enough to tell one picture in an answer from another. Remembered per picture, since it is asked on every keystroke. */
const fingerprints = new Map<string, string>();
function fingerprint(src: string): string {
  let out = fingerprints.get(src);
  if (out) return out;
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  out = (h >>> 0).toString(16);
  if (fingerprints.size > 64) fingerprints.clear();
  fingerprints.set(src, out);
  return out;
}

type Node = { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
const isNode = (n: unknown): n is Node => !!n && typeof n === "object";

/** The document with every picture's data replaced by its fingerprint, so a recovery copy is a few kilobytes however many pictures the answer holds. */
function forDraft(doc: unknown): unknown {
  if (!isNode(doc)) return doc;
  const src = doc.type === "image" ? doc.attrs?.src : undefined;
  const attrs = typeof src === "string" && src.startsWith("data:") ? { ...doc.attrs, src: PICTURE + fingerprint(src) } : doc.attrs;
  const content = doc.content ? doc.content.map(forDraft) : undefined;
  return { ...doc, ...(attrs !== doc.attrs ? { attrs } : {}), ...(content ? { content } : {}) };
}

/** The answers as the recovery copy holds them: text and layout whole, pictures by fingerprint. */
export function draftAnswers(answers: PartAnswer[]): PartAnswer[] {
  return answers.map((a) => ({ ...a, doc: forDraft(a.doc), ...(a.revision ? { revision: { ...a.revision, doc: forDraft(a.revision.doc) } } : {}) }));
}

function collectPictures(doc: unknown, into: Map<string, string>): void {
  if (!isNode(doc)) return;
  const src = doc.type === "image" ? doc.attrs?.src : undefined;
  if (typeof src === "string" && src.startsWith("data:")) into.set(fingerprint(src), src);
  doc.content?.forEach((n) => collectPictures(n, into));
}

/** The draft's document with its pictures put back from the saved copy; a picture never saved (pasted just before the tab closed) is left out rather than shown broken. */
function fromDraft(doc: unknown, pictures: Map<string, string>): unknown {
  if (!isNode(doc)) return doc;
  const src = doc.type === "image" ? doc.attrs?.src : undefined;
  if (typeof src === "string" && src.startsWith(PICTURE)) {
    const saved = pictures.get(src.slice(PICTURE.length));
    return saved ? { ...doc, attrs: { ...doc.attrs, src: saved } } : null;
  }
  const content = doc.content ? doc.content.map((n) => fromDraft(n, pictures)).filter((n) => n !== null) : undefined;
  return content ? { ...doc, content } : doc;
}

/** The recovered answers: the draft's text with the pictures the saved copy already holds. */
export function recoveredAnswers(draft: PartAnswer[], saved: PartAnswer[]): PartAnswer[] {
  const pictures = new Map<string, string>();
  for (const a of saved) { collectPictures(a.doc, pictures); collectPictures(a.revision?.doc, pictures); }
  return draft.map((a) => ({ ...a, doc: fromDraft(a.doc, pictures), ...(a.revision ? { revision: { ...a.revision, doc: fromDraft(a.revision.doc, pictures) } } : {}) }));
}

/** Synchronous recovery copy, written before the debounced IndexedDB save. Pictures stay in the database copy; the draft keeps the text. */
export function writeAnswerDraft(sessionId: string, attemptId: string, answers: PartAnswer[]): void {
  try { localStorage.setItem(PREFIX + attemptId, JSON.stringify({ sessionId, answers: draftAnswers(answers), savedAt: Date.now() })); }
  catch { /* IndexedDB autosave remains available if localStorage is full. */ }
}

export function clearAnswerDraft(attemptId: string, savedAnswers: PartAnswer[]): void {
  try {
    const raw = localStorage.getItem(PREFIX + attemptId);
    if (raw && JSON.stringify((JSON.parse(raw) as Draft).answers) === JSON.stringify(draftAnswers(savedAnswers))) {
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
        await db.attempts.update(id, { answers: recoveredAnswers(draft.answers, attempt.answers) });
      }
    });
    // Never erase a newer edit made by another tab during the transaction.
    try { if (localStorage.getItem(key) === raw) localStorage.removeItem(key); } catch { /* retry later */ }
  }
}
