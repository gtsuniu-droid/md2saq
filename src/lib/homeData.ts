import Dexie from "dexie";
import { db } from "../data/db";
import type { Attempt, Mark, PartAnswer } from "../data/types";
import { belongsToAccount } from "./progressAccount";

/**
 * What Home needs of an account's work: its submitted attempts and its marks, read through
 * the owner indexes rather than the whole tables, and held without their pictures. Home
 * only counts, dates and groups attempts; a picture's data stays in the database until an
 * answer is opened. A picture node is kept (with an empty source), so a picture-only answer
 * still counts as answered and not blank.
 */
export async function homeAttempts(ownerId: string): Promise<Attempt[]> {
  // Guest work has no owner in the compound index when it predates owners; the slow way is only for guests.
  const rows = ownerId
    ? await db.attempts.where("[ownerId+submittedAt]").between([ownerId, Dexie.minKey], [ownerId, Dexie.maxKey]).toArray()
    : await db.attempts.where("submittedAt").aboveOrEqual(0).filter((a) => belongsToAccount(a, ownerId)).toArray();
  return rows.map(withoutPictures);
}

export async function homeMarks(ownerId: string): Promise<Mark[]> {
  return ownerId ? db.marks.where("ownerId").equals(ownerId).toArray() : db.marks.filter((m) => belongsToAccount(m, ownerId)).toArray();
}

/** The attempt with every picture's data left out of its answers and revisions. */
export function withoutPictures(a: Attempt): Attempt {
  return { ...a, answers: a.answers.map(slimAnswer) };
}

function slimAnswer(x: PartAnswer): PartAnswer {
  const doc = stripPictures(x.doc);
  const out: PartAnswer = { ...x, doc };
  if (x.revision) out.revision = { ...x.revision, doc: stripPictures(x.revision.doc) };
  return out;
}

const hasPicture = (node: unknown): boolean => !!node && typeof node === "object" && ((node as { type?: unknown }).type === "image" || (Array.isArray((node as { content?: unknown }).content) && (node as { content: unknown[] }).content.some(hasPicture)));

/** The document with each image's `src` emptied; untouched (same object) when it has no picture. */
export function stripPictures(doc: unknown): unknown {
  if (!hasPicture(doc)) return doc;
  const node = doc as { type?: string; attrs?: { src?: string }; content?: unknown[] };
  const content = node.content ? node.content.map(stripPictures) : undefined;
  return { ...node, ...(node.type === "image" && node.attrs ? { attrs: { ...node.attrs, src: "" } } : {}), ...(content ? { content } : {}) };
}
