import { embedBankMedia } from "./backupMedia";
import { loadLibrary } from "./library";
import { ensureQuestionContent, ensureSetContent } from "./bank";
import { sameQuestion } from "./questionIdentity";
import { belongsToAccount } from "./progressAccount";
import { db, newId, patchSettings, getSettings } from "../data/db";
import { validateNote } from "./noteModel";
import { nextSetNumber } from "./sets";
import { numberingGroup } from "./setGroup";
import type { Attempt, Mark, Question, QuestionSet, PresentationNote } from "../data/types";

export interface ExportFile {
  format: "saq-practice";
  version: 1;
  exportedAt: number;
  sets: QuestionSet[];
  questions: Question[];
  attempts: Attempt[];
  marks: Mark[];
  notes?: PresentationNote[];
}

export type { SetPack } from "./setPack";
import type { SetPack } from "./setPack";

export async function exportAll(): Promise<ExportFile> {
  await ensureQuestionContent((await loadLibrary()).questions.map(q => q.id));
  const owner = (await getSettings()).cloudUser?.uid ?? "";
  const [sets, questions, attempts, marks, notes] = await Promise.all([
    db.sets.toArray(),
    db.questions.toArray(),
    db.attempts.filter((a) => belongsToAccount(a, owner)).toArray(),
    db.marks.filter((m) => belongsToAccount(m, owner)).toArray(),
    db.notes.filter((n) => n.ownerId === owner || n.ownerId === "").toArray(),
  ]);
  const backup = await embedBankMedia<ExportFile>({ format: "saq-practice", version: 1, exportedAt: Date.now(), sets, questions, attempts, marks, notes });
  await patchSettings({ lastExportAt: Date.now() });
  return backup;
}

export async function importAll(data: ExportFile): Promise<{ sets: number; questions: number; attempts: number; marks: number; notes: number }> {
  if (data.format !== "saq-practice") throw new Error("Not an SAQ Practice export file.");
  const owner = (await getSettings()).cloudUser?.uid ?? "";
  const notes = (data.notes ?? []).map((n) => ({ ...n, ownerId: owner, _m: Date.now(), revision: newId() }));
  notes.forEach((note) => validateNote(note));
  await db.transaction("rw", [db.sets, db.questions, db.attempts, db.marks, db.notes], async () => {
    await db.sets.bulkPut(data.sets);
    await db.questions.bulkPut(data.questions);
    const attemptIds = new Map<string, string>();
    for (const attempt of data.attempts) {
      const existing = await db.attempts.get(attempt.id);
      const id = existing && !belongsToAccount(existing, owner) ? newId() : attempt.id;
      attemptIds.set(attempt.id, id);
      await db.attempts.put({ ...attempt, id, ownerId: owner });
    }
    for (const mark of data.marks) {
      const existing = await db.marks.get(mark.id);
      const id = existing && !belongsToAccount(existing, owner) ? newId() : mark.id;
      await db.marks.put({ ...mark, id, attemptId: attemptIds.get(mark.attemptId) ?? mark.attemptId, ownerId: owner });
    }
    for (const note of notes) {
      const existing = await db.notes.get(note.id);
      await db.notes.put(existing && existing.ownerId !== owner ? { ...note, id: newId() } : note);
    }
  });
  return { sets: data.sets.length, questions: data.questions.length, attempts: data.attempts.length, marks: data.marks.length, notes: notes.length };
}

export async function exportSet(setId: string): Promise<SetPack> {
  await ensureSetContent(setId);
  const set = await db.sets.get(setId);
  if (!set) throw new Error("Set not found.");
  const questions = await db.questions.where("setId").equals(setId).sortBy("order");
  return { format: "saq-practice-set", version: 1, set, questions: questions.map(q => ({ ...q, id: q.bankQuestionId ?? q.id })) };
}

/** Import a shared set with fresh ids so it never collides with local data. */
export async function importSetPack(pack: SetPack, bankId?: string, bankUpdatedAt?: number, number?: number): Promise<string> {
  if (pack.format !== "saq-practice-set") throw new Error("Not a question set file.");
  // Keep the pack's ids so every device that imports this set agrees on question ids
  // (synced attempts refer to them). Fall back to fresh ids only on a collision.
  const clash = !!(await db.sets.get(pack.set.id)) || (await db.questions.where("id").anyOf(pack.questions.map((q) => q.id)).count()) > 0;
  const setId = clash ? newId() : pack.set.id;
  const num = number ?? pack.set.number ?? (await nextSetNumber(numberingGroup(pack.set.tags, pack.questions, pack.set.primaryPresentation)));
  const set: QuestionSet = { ...pack.set, id: setId, number: num, createdAt: Date.now(), updatedAt: undefined, bankId, bankUpdatedAt };
  const questions: Question[] = pack.questions.map((q) => ({ ...q, id: clash ? newId() : q.id, bankQuestionId: q.bankQuestionId ?? q.id, setId, createdAt: Date.now() }));
  await db.transaction("rw", db.sets, db.questions, async () => {
    await db.sets.add(set);
    await db.questions.bulkAdd(questions);
  });
  return setId;
}

function tsvCell(s: string): string {
  return s.replace(/\t/g, "  ").replace(/\r?\n/g, "<br>");
}

/** Learning points as Anki-importable TSV: front = question, back = learning point. */
export async function exportLearningPointsTsv(): Promise<string> {
  const owner = (await getSettings()).cloudUser?.uid ?? "";
  const marks = (await db.marks.toArray()).filter((m) => belongsToAccount(m, owner) && m.learningPoint && m.learningPoint.trim());
  const rows: string[] = [];
  for (const m of marks) {
    const q = await db.questions.get(m.questionId);
    if (!q) continue;
    rows.push([tsvCell(q.text), tsvCell(m.learningPoint!.trim()), q.presentations.join(" ")].join("\t"));
  }
  return rows.join("\n") + (rows.length ? "\n" : "");
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/**
 * Refresh a local copy by published question identity, keeping local attempt links
 * intact when questions move. Legacy imports can be matched by unambiguous content.
 */
export async function applyBankUpdate(localSetId: string, pack: SetPack, bankUpdatedAt: number): Promise<void> {
  const local = await db.sets.get(localSetId);
  if (!local) return;
  const existing = await db.questions.where("setId").equals(localSetId).sortBy("order");
  await db.transaction("rw", db.sets, db.questions, async () => {
    // The number comes from the bank's index, which is renumbered as sets come and go; the pack's copy may be stale.
    const { id: _id, createdAt: _c, bankId: _b, number: _n, ...rest } = pack.set;
    void _id; void _c; void _b; void _n;
    await db.sets.put({ ...local, ...rest, id: localSetId, bankUpdatedAt, updatedAt: bankUpdatedAt });
    const incoming = [...pack.questions].sort((a, b) => a.order - b.order);
    const kept = new Set<string>();
    const incomingIds = new Set(incoming.map(q => q.bankQuestionId ?? q.id));
    for (let i = 0; i < incoming.length; i++) {
      const q = incoming[i];
      const canonicalId = q.bankQuestionId ?? q.id;
      let keep = existing.find(old => !kept.has(old.id) && (old.bankQuestionId ?? old.id) === canonicalId);
      if (!keep) {
        const legacy = existing.filter(old => !kept.has(old.id) && !old.bankQuestionId && !incomingIds.has(old.id) && sameQuestion(old, q));
        if (legacy.length === 1) keep = legacy[0];
      }
      if (keep) kept.add(keep.id);
      const id = keep?.id ?? (await db.questions.get(canonicalId) ? `bank:${local.bankId ?? localSetId}:${canonicalId}` : canonicalId);
      await db.questions.put({ ...q, id, bankQuestionId: canonicalId, setId: localSetId, order: i, createdAt: keep?.createdAt ?? Date.now() });
    }
    for (const q of existing) if (!kept.has(q.id)) await db.questions.delete(q.id);
  });
}
