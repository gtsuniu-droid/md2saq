import { db, newId } from "../data/db";
import type { AnswerComment } from "../data/types";
import { GENERAL_ANCHOR } from "./answerComments";
import { renderAnswer } from "./answerRender";
import { idToken } from "./firebase";
import type { SetForMarking, SuggestedMarks } from "./setForMarking";
import { requestSync } from "./sync";

/**
 * Suggested marks: a student keeps each set they open for marking in their private store,
 * where their connected assistant can read it and leave marks. The marking page fills those
 * in for the student to check and save. Nothing here shows unless marks were sent.
 */
const authed = async (): Promise<Record<string, string> | null> => { const t = await idToken().catch(() => null); return t ? { authorization: `Bearer ${t}` } : null; };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* fine */ } };

/** Keep the set in the student's store, unless this exact copy is already there. */
export async function keepForMarking(s: SetForMarking): Promise<void> {
  const body = JSON.stringify(s);
  const k = `marking.kept.${s.key}`;
  if (read(k) === String(body.length) + body.slice(-64)) return;
  const auth = await authed();
  if (!auth) return;
  const res = await fetch("/api/answers", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body });
  if (res.ok) write(k, String(body.length) + body.slice(-64));
}

/** Marks suggested for the set and not yet filled in on this device, or null. */
export async function newSuggestions(key: string): Promise<SuggestedMarks | null> {
  const auth = await authed();
  if (!auth) return null;
  const res = await fetch(`/api/answers?key=${encodeURIComponent(key)}`, { headers: auth });
  if (!res.ok) return null;
  const { suggested } = (await res.json()) as { suggested: SuggestedMarks | null };
  return suggested && suggested.at > Number(read(`marking.filled.${key}`) ?? 0) ? suggested : null;
}

export const markFilled = (key: string, marks: SuggestedMarks) => write(`marking.filled.${key}`, String(marks.at));

/**
 * The suggested comments on the answers themselves, replacing any sent before: a part's
 * feedback on the whole answer, and each quoted passage where the page shows it. A quote the
 * page cannot find (the answer was edited, say) stays as a comment on the whole answer.
 */
export async function placeSuggestedComments(marks: SuggestedMarks): Promise<void> {
  const now = Date.now();
  const byAttempt = new Map<string, SuggestedMarks["parts"]>();
  for (const p of marks.parts) byAttempt.set(p.attemptId, [...(byAttempt.get(p.attemptId) ?? []), p]);
  await db.transaction("rw", db.attempts, async () => {
    for (const [attemptId, parts] of byAttempt) {
      const attempt = await db.attempts.get(attemptId);
      if (!attempt) continue;
      const added: AnswerComment[] = parts.flatMap((p) => {
        const answer = attempt.answers.find((a) => a.label === p.label);
        const plain = renderAnswer(answer?.doc, answer?.text ?? "").textContent ?? "";
        const one = (anchor: Pick<AnswerComment, "start" | "end" | "quote">, text: string): AnswerComment => ({ id: newId(), partLabel: p.label, ...anchor, text, createdAt: now, updatedAt: now, by: "marker" });
        return [
          ...(p.feedback ? [one(GENERAL_ANCHOR, p.feedback)] : []),
          ...p.comments.map((c) => {
            const start = plain.indexOf(c.quote);
            return start >= 0 ? one({ start, end: start + c.quote.length, quote: c.quote }, c.text) : one(GENERAL_ANCHOR, `“${c.quote}”: ${c.text}`);
          }),
        ];
      });
      await db.attempts.update(attemptId, { answerComments: [...(attempt.answerComments ?? []).filter((c) => c.by !== "marker"), ...added] });
    }
  });
  requestSync();
}
