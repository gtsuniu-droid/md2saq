import type { Mark } from "../data/types";
import type { MarkingDraft } from "./markingSet";

const PREFIX = "saq-marking-draft-v1:";
/** Sent on the window whenever a draft is written or cleared, for views that follow marking as it happens. */
export const MARKING_DRAFT_EVENT = "saq-marking-draft";
const changed = () => { try { window.dispatchEvent(new Event(MARKING_DRAFT_EVENT)); } catch { /* no window */ } };
interface SavedDraft {
  questionId: string;
  markId: string | null;
  markedAt: number | null;
  draft: MarkingDraft;
}

function storageKey(ownerId: string, attemptId: string): string {
  return `${PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(attemptId)}`;
}

function isDraft(value: unknown): value is MarkingDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<MarkingDraft>;
  return Array.isArray(draft.parts) && draft.parts.every((part) => part && typeof part.label === "string"
    && Number.isFinite(part.score) && Number.isFinite(part.maxScore)
    && Array.isArray(part.pointsHit) && part.pointsHit.every(Number.isFinite))
    && Array.isArray(draft.errorTags) && draft.errorTags.every((tag) => typeof tag === "string")
    && typeof draft.learningPoint === "string" && typeof draft.notes === "string"
    && typeof draft.reviewLater === "boolean" && typeof draft.lookedAtAnswer === "boolean"
    && (draft.confidence === undefined || Number.isFinite(draft.confidence))
    && (draft.scored === undefined || (Array.isArray(draft.scored) && draft.scored.every((label) => typeof label === "string")));
}

/** Recover only edits based on the same saved marking; a newer explicit save wins. */
export function loadMarkingDraft(ownerId: string, attemptId: string, questionId: string, mark?: Mark): MarkingDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(ownerId, attemptId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedDraft | null;
    if (!saved || saved.questionId !== questionId || saved.markId !== (mark?.id ?? null)
      || saved.markedAt !== (mark?.markedAt ?? null) || !isDraft(saved.draft)) return null;
    return saved.draft;
  } catch { return null; }
}

/** Keep drafts on this device without changing submitted results or syncing scores. */
export function writeMarkingDraft(ownerId: string, attemptId: string, questionId: string, draft: MarkingDraft, mark?: Mark): boolean {
  try {
    const saved: SavedDraft = { questionId, markId: mark?.id ?? null, markedAt: mark?.markedAt ?? null, draft };
    localStorage.setItem(storageKey(ownerId, attemptId), JSON.stringify(saved));
    changed();
    return true;
  } catch { return false; }
}

/** A completed save must not erase a newer edit made in another tab. */
/** Forget every marking draft on this device. */
export function clearAllMarkingDrafts(): void {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k); } catch { /* storage unavailable */ }
  changed();
}

export function clearMarkingDraft(ownerId: string, attemptId: string, savedDraft: MarkingDraft): void {
  try {
    const key = storageKey(ownerId, attemptId);
    const raw = localStorage.getItem(key);
    if (raw && JSON.stringify((JSON.parse(raw) as SavedDraft).draft) === JSON.stringify(savedDraft)) { localStorage.removeItem(key); changed(); }
  } catch { /* Leave the recovery copy in place if storage is unavailable. */ }
}
