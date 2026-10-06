import { db, getSettings } from "../data/db";
import type { Question } from "../data/types";

// Per-device bookkeeping is never included in bank exports or account cloud sync.
const prefix = (ownerId: string) => `personal-set-edits:v1:${encodeURIComponent(ownerId)}:`;
const keyFor = (ownerId: string, setId: string) => `${prefix(ownerId)}${encodeURIComponent(setId)}`;
const fields = ["text", "textDoc", "stems", "stemDocs", "parts", "images", "modelAnswer", "modelAnswerDoc", "marks"] as const;
type QuestionEdits = Partial<Pick<Question, typeof fields[number]>>;
export interface PersonalSetEdits { setId: string; questions: Record<string, QuestionEdits>; }

export function applyPersonalSetEdits(questions: Question[], edits?: PersonalSetEdits | null): Question[] {
  if (!edits) return questions;
  return questions.map((q) => {
    const patch = q.setId === edits.setId ? edits.questions[q.id] : undefined;
    if (!patch) return q;
    const allowed: QuestionEdits = {};
    for (const field of fields) if (Object.prototype.hasOwnProperty.call(patch, field)) Object.assign(allowed, { [field]: patch[field] ?? undefined });
    return { ...q, ...allowed };
  });
}

export async function loadPersonalSetEdits(ownerId: string): Promise<Map<string, PersonalSetEdits>> {
  const rows = await db.meta.where("id").startsWith(prefix(ownerId)).toArray();
  const edits = new Map<string, PersonalSetEdits>();
  for (const row of rows) {
    try {
      const value = JSON.parse(String(row.value)) as PersonalSetEdits;
      if (typeof value.setId === "string" && value.questions && typeof value.questions === "object") edits.set(value.setId, value);
    } catch { /* A damaged local copy must not hide the shared library. */ }
  }
  return edits;
}

export async function savePersonalSetEdits(ownerId: string, setId: string, original: Question[], edited: Question[]): Promise<void> {
  if (((await getSettings()).cloudUser?.uid ?? "") !== ownerId) throw new Error("Your account changed. Reopen this set before saving.");
  const questions: Record<string, QuestionEdits> = {};
  for (const q of edited) {
    const source = original.find((item) => item.id === q.id && item.setId === setId);
    if (!source) continue;
    const patch: QuestionEdits = {};
    for (const field of fields) {
      if (JSON.stringify(q[field]) !== JSON.stringify(source[field])) Object.assign(patch, { [field]: q[field] ?? null });
    }
    if (Object.keys(patch).length) questions[q.id] = patch;
  }
  if (Object.keys(questions).length) await db.meta.put({ id: keyFor(ownerId, setId), value: JSON.stringify({ setId, questions }) });
  else await resetPersonalSetEdits(ownerId, setId);
}

export async function resetPersonalSetEdits(ownerId: string, setId: string): Promise<void> {
  await db.meta.delete(keyFor(ownerId, setId));
}
