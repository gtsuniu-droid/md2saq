import { db, newId, patchSettings } from "../data/db";
import { nextSetNumber } from "./sets";
import { numberingGroup } from "./setGroup";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";

export interface ExportFile {
  format: "saq-practice";
  version: 1;
  exportedAt: number;
  sets: QuestionSet[];
  questions: Question[];
  attempts: Attempt[];
  marks: Mark[];
}

/** A set with its questions only, for sharing. */
export interface SetPack {
  format: "saq-practice-set";
  version: 1;
  set: QuestionSet;
  questions: Question[];
}

export async function exportAll(): Promise<ExportFile> {
  const [sets, questions, attempts, marks] = await Promise.all([
    db.sets.toArray(),
    db.questions.toArray(),
    db.attempts.toArray(),
    db.marks.toArray(),
  ]);
  await patchSettings({ lastExportAt: Date.now() });
  return { format: "saq-practice", version: 1, exportedAt: Date.now(), sets, questions, attempts, marks };
}

export async function importAll(data: ExportFile): Promise<{ sets: number; questions: number; attempts: number; marks: number }> {
  if (data.format !== "saq-practice") throw new Error("Not an SAQ Practice export file.");
  await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
    await db.sets.bulkPut(data.sets);
    await db.questions.bulkPut(data.questions);
    await db.attempts.bulkPut(data.attempts);
    await db.marks.bulkPut(data.marks);
  });
  return { sets: data.sets.length, questions: data.questions.length, attempts: data.attempts.length, marks: data.marks.length };
}

export async function exportSet(setId: string): Promise<SetPack> {
  const set = await db.sets.get(setId);
  if (!set) throw new Error("Set not found.");
  const questions = await db.questions.where("setId").equals(setId).sortBy("order");
  return { format: "saq-practice-set", version: 1, set, questions };
}

/** Import a shared set with fresh ids so it never collides with local data. */
export async function importSetPack(pack: SetPack, bankId?: string, bankUpdatedAt?: number, number?: number): Promise<string> {
  if (pack.format !== "saq-practice-set") throw new Error("Not a question set file.");
  // Keep the pack's ids so every device that imports this set agrees on question ids
  // (synced attempts refer to them). Fall back to fresh ids only on a collision.
  const clash = !!(await db.sets.get(pack.set.id)) || (await db.questions.where("id").anyOf(pack.questions.map((q) => q.id)).count()) > 0;
  const setId = clash ? newId() : pack.set.id;
  const num = number ?? pack.set.number ?? (await nextSetNumber(numberingGroup(pack.set.tags, pack.questions)));
  const set: QuestionSet = { ...pack.set, id: setId, number: num, createdAt: Date.now(), updatedAt: undefined, bankId, bankUpdatedAt };
  const questions: Question[] = pack.questions.map((q) => ({ ...q, id: clash ? newId() : q.id, setId, createdAt: Date.now() }));
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
  const marks = (await db.marks.toArray()).filter((m) => m.learningPoint && m.learningPoint.trim());
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
 * Refresh a local copy from a newer bank version. Questions are matched by
 * position so existing question ids, and therefore attempts and marks, survive.
 */
export async function applyBankUpdate(localSetId: string, pack: SetPack, bankUpdatedAt: number): Promise<void> {
  const local = await db.sets.get(localSetId);
  if (!local) return;
  const existing = await db.questions.where("setId").equals(localSetId).sortBy("order");
  await db.transaction("rw", db.sets, db.questions, async () => {
    const { id: _id, createdAt: _c, bankId: _b, ...rest } = pack.set;
    void _id; void _c; void _b;
    await db.sets.put({ ...local, ...rest, id: localSetId, bankUpdatedAt, updatedAt: bankUpdatedAt });
    const incoming = [...pack.questions].sort((a, b) => a.order - b.order);
    for (let i = 0; i < incoming.length; i++) {
      const q = incoming[i];
      const keep = existing[i];
      await db.questions.put({ ...q, id: keep?.id ?? newId(), setId: localSetId, order: i, createdAt: keep?.createdAt ?? Date.now() });
    }
    for (const q of existing.slice(incoming.length)) await db.questions.delete(q.id);
  });
}
