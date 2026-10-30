import { db } from "../data/db";
import type { Question, QuestionSet } from "../data/types";
import { legacyQuestionIds, CATALOGUE_KEY, type BankCatalogue } from "./bankCatalogue";
import { hasUnpublishedEdits } from "./bankEditState";

export async function readCatalogue(): Promise<BankCatalogue | undefined> {
  const value = (await db.meta.get(CATALOGUE_KEY))?.value;
  return typeof value === "string" ? JSON.parse(value) as BankCatalogue : undefined;
}

/** Catalogue rows stay separate from editable/cached content. Never publish a summary. */
/**
 * The library as this device sees it. `pending` sets are known from the catalogue but not yet
 * downloaded. `behind` sets have unpublished edits here while the bank has moved on since
 * (someone published a newer version, perhaps through the connector): the local copy is shown,
 * and the page can offer the update, keyed here by the bank's revision.
 */
export async function loadLibrary(): Promise<{ sets: QuestionSet[]; questions: Question[]; pending: Set<string>; behind: Map<string, number> }> {
  const [catalogue, cachedSets, cachedQuestions] = await Promise.all([readCatalogue(), db.sets.toArray(), db.questions.toArray()]);
  const sets: QuestionSet[] = [];
  const questions: Question[] = [];
  const pending = new Set<string>();
  const behind = new Map<string, number>();
  const seen = new Set<string>();
  const byBank = new Map(cachedSets.filter(s => s.bankId).map(s => [s.bankId!, s]));
  const byId = new Map(cachedSets.map(s => [s.id, s]));
  const questionIds = new Set(cachedQuestions.map(q => q.id));
  const bySet = new Map<string, Question[]>();
  for (const q of cachedQuestions) bySet.set(q.setId, [...bySet.get(q.setId) ?? [], q]);
  for (const entry of catalogue?.entries ?? []) {
    const local = byBank.get(entry.id) ?? byId.get(entry.set.id);
    const setId = local?.id ?? entry.set.id;
    if (seen.has(setId)) continue;
    seen.add(setId);
    const members = bySet.get(setId) ?? [];
    if (local && (hasUnpublishedEdits(local) || (local.bankUpdatedAt ?? 0) >= entry.revision)) {
      sets.push({ ...local, bankId: entry.id, number: entry.set.number ?? local.number });
      questions.push(...members);
      if ((local.bankUpdatedAt ?? 0) < entry.revision) behind.set(setId, entry.revision);
    } else {
      sets.push({ ...entry.set, id: setId });
      const ids = new Map([...(await legacyQuestionIds(entry, members)), ...members.map(q => [q.bankQuestionId ?? q.id, q.id] as const)]);
      questions.push(...entry.questions.map(q => ({ ...q, id: ids.get(q.bankQuestionId ?? q.id) ?? (questionIds.has(q.id) ? `bank:${entry.id}:${q.id}` : q.id), setId })));
      pending.add(setId);
    }
  }
  // Local work remains available, as do old cached sets needed by saved attempts.
  for (const s of cachedSets) if (!seen.has(s.id) && (!catalogue || !s.bankId || s.dirty)) {
    sets.push(s); questions.push(...bySet.get(s.id) ?? []);
  }
  return { sets, questions, pending, behind };
}

export interface LibraryBreakdown {
  /** Sets in the shared bank's catalogue, the same on every device. */
  published: number;
  /** Sets written on this device and never published. */
  unpublished: number;
  /** Personal copies of sets that have since been removed from the bank, still shown here. */
  removed: number;
  removedIds: string[];
}

/** Why one device's set count differs from another's: only the published figure is shared. */
export async function libraryBreakdown(): Promise<LibraryBreakdown> {
  const [catalogue, sets] = await Promise.all([readCatalogue(), db.sets.toArray()]);
  const live = new Set(catalogue?.entries.map((e) => e.id) ?? []);
  const unpublished = sets.filter((s) => !s.bankId).length;
  const removedIds = catalogue ? sets.filter((s) => s.bankId && s.dirty && !live.has(s.bankId)).map((s) => s.id) : [];
  return { published: live.size, unpublished, removed: removedIds.length, removedIds };
}

/**
 * Stop showing copies of sets the bank no longer has. The copies and their questions stay
 * on the device so past attempts can still be read; they just leave the library.
 */
export async function hideRemovedCopies(): Promise<number> {
  const { removedIds } = await libraryBreakdown();
  await db.transaction("rw", db.sets, async () => { for (const id of removedIds) await db.sets.update(id, { dirty: false }); });
  return removedIds.length;
}
