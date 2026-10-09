import { db } from "../data/db";
import type { Question, QuestionSet } from "../data/types";
import { legacyQuestionIds, CATALOGUE_KEY, type BankCatalogue } from "./bankCatalogue";

export async function readCatalogue(): Promise<BankCatalogue | undefined> {
  const value = (await db.meta.get(CATALOGUE_KEY))?.value;
  return typeof value === "string" ? JSON.parse(value) as BankCatalogue : undefined;
}

/** Catalogue rows stay separate from editable/cached content. Never publish a summary. */
export async function loadLibrary(): Promise<{ sets: QuestionSet[]; questions: Question[]; pending: Set<string> }> {
  const [catalogue, cachedSets, cachedQuestions] = await Promise.all([readCatalogue(), db.sets.toArray(), db.questions.toArray()]);
  const sets: QuestionSet[] = [];
  const questions: Question[] = [];
  const pending = new Set<string>();
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
    if (local && (local.dirty || (local.bankUpdatedAt ?? 0) >= entry.revision)) {
      sets.push({ ...local, bankId: entry.id, number: entry.set.number ?? local.number });
      questions.push(...members);
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
  return { sets, questions, pending };
}
