import type { Question } from "../data/types";
import type { SetPack } from "./setPack";

export function questionIdentityText(q: Question): string {
  return JSON.stringify([q.text, q.textDoc ?? null, q.stemDocs ?? [], q.stems ?? [], q.parts.map(p => [p.label, p.text, p.textDoc ?? null]), q.images ?? []]);
}

/** Ignore local IDs and marking state when matching older imported questions. */
export function sameQuestion(a: Question, b: Question): boolean {
  return questionIdentityText(a) === questionIdentityText(b);
}

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function questionIdentityHash(q: Question): Promise<string> {
  const text = questionIdentityText(q);
  const images = new Set<string>();
  JSON.parse(text, (_key, value) => {
    if (typeof value === "string" && /^data:image\/(png|jpe?g|webp|gif|avif);base64,/.test(value)) images.add(value);
    return value;
  });
  const hashes = new Map(await Promise.all([...images].map(async image => [image, await digest(image)] as const)));
  // Moving the same image from inline data to a content-addressed URL must not
  // break matching on a device that still has an older, unlinked import.
  const normalised = JSON.stringify(JSON.parse(text), (_key, value) => {
    if (typeof value !== "string") return value;
    const id = hashes.get(value) ?? /^https?:\/\/[^/]+\/api\/bank\?image=([a-f0-9]{64})$/.exec(value)?.[1];
    return id ? `bank-image:${id}` : value;
  });
  return digest(normalised);
}

export function publishedQuestion(pack: SetPack, local: Question): Question | undefined {
  const id = local.bankQuestionId ?? local.id;
  const exact = pack.questions.find(q => q.id === id);
  if (exact) return exact;
  // Legacy imports may have remapped IDs. Never guess using a mutable position.
  if (local.bankQuestionId) return undefined;
  const matches = pack.questions.filter(q => sameQuestion(q, local));
  return matches.length === 1 ? matches[0] : undefined;
}

