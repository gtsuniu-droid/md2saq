import { openNamedStore } from "./store";
import type { SetForMarking, SuggestedMarks } from "../../src/lib/setForMarking";

/**
 * Each student's recently marked sets, laid out for marking, in one private blob per account.
 * The site keeps them here so the student's connected assistant can read them and leave
 * suggested marks, which the marking page picks up. Only the account's own sign-in or its own
 * connection link reaches its blob.
 */
export type StoredSet = SetForMarking & { suggested?: SuggestedMarks };
type Shelf = { sets: StoredSet[] };
const KEEP = 20;
const key = (uid: string) => `users/${uid}`;
const store = () => openNamedStore("answers");

export async function mySets(uid: string): Promise<StoredSet[]> {
  return (((await store().get(key(uid), { type: "json" })) as Shelf | null)?.sets ?? []);
}

/** Keep a set, newest first; marks already suggested for it stay with it. */
export async function keepSet(uid: string, s: SetForMarking): Promise<void> {
  await store().update<Shelf>(key(uid), (cur) => {
    const sets = cur?.sets ?? [];
    const old = sets.find((x) => x.key === s.key);
    const next = [{ ...s, ...(old?.suggested ? { suggested: old.suggested } : {}) }, ...sets.filter((x) => x.key !== s.key)];
    return { sets: next.sort((a, b) => b.at - a.at).slice(0, KEEP) };
  });
}

export async function suggest(uid: string, setKey: string, marks: SuggestedMarks): Promise<void> {
  await store().update<Shelf>(key(uid), (cur) => cur && cur.sets.some((x) => x.key === setKey)
    ? { sets: cur.sets.map((x) => x.key === setKey ? { ...x, suggested: marks } : x) }
    : null);
}

/**
 * A set by its id; for a query that speaks of an exam ("exam", "the exam I just did"), the most
 * recent whole exam paper; else by name or number (any part of it, any case); else the most recent.
 */
export function findSet(sets: StoredSet[], query?: string): StoredSet | undefined {
  const q = query?.trim();
  if (!q) return sets[0];
  const byKey = sets.find((s) => s.key === q);
  if (byKey) return byKey;
  if (/\bexams?\b/i.test(q)) { const exam = sets.find((s) => s.exam); if (exam) return exam; }
  return sets.find((s) => s.name.toLowerCase().includes(q.toLowerCase()));
}

/** A posted set, checked for shape and size before it is kept. */
export function validSet(b: unknown): SetForMarking | null {
  if (!b || typeof b !== "object" || JSON.stringify(b).length > 400_000) return null;
  const s = b as SetForMarking;
  const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
  const ok = str(s.key, 100) && !!s.key && str(s.name, 300) && typeof s.at === "number" && (s.notes === undefined || str(s.notes, 50_000)) && Array.isArray(s.questions) && s.questions.length <= 60
    && s.questions.every((q) => str(q.attemptId, 100) && typeof q.number === "number" && Array.isArray(q.stems) && q.stems.every((t) => str(t, 50_000)) && str(q.text, 20_000) && str(q.model, 50_000) && Array.isArray(q.parts) && q.parts.length <= 20
      && q.parts.every((p) => str(p.id, 40) && str(p.label, 20) && typeof p.marks === "number" && str(p.prompt, 20_000) && str(p.answer, 100_000) && str(p.model, 50_000)));
  return ok ? { key: s.key, name: s.name, at: s.at, ...(s.notes ? { notes: s.notes } : {}), ...(s.exam === true ? { exam: true } : {}), questions: s.questions } : null;
}
