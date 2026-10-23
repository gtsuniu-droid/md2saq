import { questionIdentityHash } from "./questionIdentity";
import type { Question, QuestionSet } from "../data/types";
import type { SetPack } from "./setPack";
import { primaryPresentation } from "./primaryPresentation";

export interface CatalogueEntry {
  id: string;
  revision: number;
  identityKeys?: Record<string, string>;
  set: QuestionSet;
  questions: Question[];
}
export interface BankCatalogue { version: 1; entries: CatalogueEntry[] }
export const CATALOGUE_KEY = "bank.catalogue.v1";

/** Explicit allowlist: the searchable catalogue never carries images, rich docs or answers. */
export function catalogueEntry(id: string, revision: number, pack: SetPack, number?: number): CatalogueEntry {
  const s = pack.set;
  return {
    id, revision,
    set: { id: s.id, name: s.name, source: s.source, collection: s.collection, tags: s.tags,
      primaryPresentation: primaryPresentation(s, pack.questions), suggestedMinutes: s.suggestedMinutes,
      number: number ?? s.number, createdAt: s.createdAt, bankId: id, bankUpdatedAt: revision, reviewFlags: s.reviewFlags?.length ? s.reviewFlags : undefined },
    questions: pack.questions.map(q => ({ id: q.bankQuestionId ?? q.id, bankQuestionId: q.bankQuestionId ?? q.id,
      setId: s.id, order: q.order, text: q.text, stems: q.stems, marks: q.marks,
      parts: (q.parts ?? []).map(p => ({ label: p.label, text: p.text, marks: p.marks })),
      presentations: q.presentations, tags: q.tags, createdAt: q.createdAt })),
  };
}

/** Small fingerprints let old imports keep their local IDs without putting images in the catalogue. */
export async function withIdentityKeys(entry: CatalogueEntry, questions: Question[]): Promise<CatalogueEntry> {
  return { ...entry, identityKeys: Object.fromEntries(await Promise.all(questions.map(async q => [q.bankQuestionId ?? q.id, await questionIdentityHash({ ...q, parts: q.parts ?? [] })]))) };
}

export async function legacyQuestionIds(entry: CatalogueEntry, existing: Question[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!entry.identityKeys) return out;
  const incoming = new Set(entry.questions.map(q => q.bankQuestionId ?? q.id));
  const candidates = await Promise.all(existing.filter(q => !q.bankQuestionId && !incoming.has(q.id)).map(async q => ({ id: q.id, hash: await questionIdentityHash(q) })));
  for (const [canonical, hash] of Object.entries(entry.identityKeys)) {
    const matches = candidates.filter(q => q.hash === hash);
    if (matches.length === 1 && Object.values(entry.identityKeys).filter(key => key === hash).length === 1) out.set(canonical, matches[0].id);
  }
  return out;
}
