import type { Question, QuestionSet } from "../data/types";
import type { SharedStemMembership } from "./sharedStems";

export interface SetEditorDraft { set: QuestionSet; questions: Question[]; tags: string[]; sharedStems?: SharedStemMembership[] }
interface Recovery { updatedAt: number | null; bankUpdatedAt: number | null; draft: SetEditorDraft }
const keyFor = (ownerId: string, setId: string) => `saq-set-editor-draft-v1:${encodeURIComponent(ownerId)}:${encodeURIComponent(setId)}`;

function validDraft(value: unknown, setId: string): value is SetEditorDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SetEditorDraft>;
  return !!draft.set && draft.set.id === setId && typeof draft.set.name === "string"
    && Array.isArray(draft.tags) && draft.tags.every((tag) => typeof tag === "string")
    && (draft.sharedStems === undefined || Array.isArray(draft.sharedStems) && draft.sharedStems.every((group) => group && Number.isInteger(group.stemIndex) && Array.isArray(group.questionIds) && group.questionIds.every((id) => typeof id === "string")))
    && Array.isArray(draft.questions) && draft.questions.every((q) => q && q.setId === setId
      && typeof q.id === "string" && typeof q.text === "string" && Array.isArray(q.parts)
      && q.parts.every((part) => part && typeof part.label === "string" && typeof part.text === "string")
      && Array.isArray(q.tags) && Array.isArray(q.presentations)
      && (q.stems === undefined || Array.isArray(q.stems) && q.stems.every((stem) => typeof stem === "string")));
}

/** A newer saved/published set takes priority over an abandoned editing draft. */
export function loadSetEditorDraft(ownerId: string, base: QuestionSet): SetEditorDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(ownerId, base.id));
    if (!raw) return null;
    const recovery = JSON.parse(raw) as Recovery | null;
    return recovery && recovery.updatedAt === (base.updatedAt ?? null)
      && recovery.bankUpdatedAt === (base.bankUpdatedAt ?? null) && validDraft(recovery.draft, base.id)
      ? recovery.draft : null;
  } catch { return null; }
}

/** Recovery stays on this device and never publishes or changes the library. */
export function writeSetEditorDraft(ownerId: string, base: QuestionSet, draft: SetEditorDraft): boolean {
  try {
    const recovery: Recovery = { updatedAt: base.updatedAt ?? null, bankUpdatedAt: base.bankUpdatedAt ?? null, draft };
    localStorage.setItem(keyFor(ownerId, base.id), JSON.stringify(recovery));
    return true;
  } catch { return false; }
}

/** Do not delete newer edits from another tab when an earlier save completes. */
export function clearSetEditorDraft(ownerId: string, setId: string, savedDraft: SetEditorDraft): void {
  try {
    const key = keyFor(ownerId, setId);
    const raw = localStorage.getItem(key);
    if (raw && JSON.stringify((JSON.parse(raw) as Recovery).draft) === JSON.stringify(savedDraft)) localStorage.removeItem(key);
  } catch { /* Keep the recovery copy when storage cannot be read. */ }
}
