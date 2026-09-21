import type { PresentationNote } from "../data/types";
import { PRESENTATION_BY_ID } from "../data/presentations";

export const NOTE_KINDS = ["Lecture Notes", "My Notes", "Missed Questions", "First Aid", "Sketchy", "Sketchy 2", "Sketchy Extra", "Bootcamp", "Pathoma", "Boards and Beyond", "OneNote"];
export const MAX_NOTE_BYTES = 750_000;
export const MAX_SHARED_NOTE_BYTES = 5_500_000;
export function noteIsNewer(a: PresentationNote, b: PresentationNote): boolean {
  return a._m > b._m || (a._m === b._m && a.revision > b.revision);
}
export function validateNote(note: PresentationNote, maxBytes = MAX_NOTE_BYTES): void {
  if (!note || typeof note.id !== "string" || !note.id || note.id.includes("/") ||
    typeof note.presentationId !== "string" || !PRESENTATION_BY_ID.has(note.presentationId) ||
    typeof note.title !== "string" || !note.title.trim() || note.title.length > 200 ||
    typeof note.kind !== "string" || !note.kind.trim() || note.kind.length > 80 ||
    typeof note.text !== "string" || typeof note.source !== "string" ||
    typeof note.ownerId !== "string" || typeof note.revision !== "string" ||
    !Number.isFinite(note._m) || !Number.isFinite(note.createdAt) || typeof note.deleted !== "boolean" ||
    !note.doc || typeof note.doc !== "object" || (note.doc as { type?: string }).type !== "doc") {
    throw new Error("This note is missing a valid title, presentation or content.");
  }
  if (new TextEncoder().encode(JSON.stringify(note)).length > maxBytes) {
    throw new Error("This note is too large to sync. Split it into smaller notes or use smaller pictures.");
  }
}
