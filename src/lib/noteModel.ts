import type { NoteSection, PresentationNote } from "../data/types";
import { PRESENTATION_BY_ID } from "../data/presentations";

export type SectionInfo = { id: NoteSection; label: string; description: string };
/** The sections a note can be filed under. */
export const NOTE_SECTIONS: SectionInfo[] = [
  { id: "ddx", label: "DDx", description: "Differential diagnoses" },
  { id: "hx-exam", label: "Hx / Exam", description: "History and examination features" },
  { id: "ix", label: "Ix", description: "Investigations" },
  { id: "mx", label: "Mx", description: "Management" },
  { id: "extras", label: "Cases / Extras", description: "Cases and additional reference material" },
];
/**
 * Overview is no longer offered. Notes already in it, and older notes saved before sections
 * existed, stay there, and the tab shows only where such notes are, until they are moved.
 */
export const OVERVIEW: SectionInfo = { id: "overview", label: "Overview", description: "Notes from before sections, and older overview notes" };
export function noteSection(value: unknown): NoteSection {
  return NOTE_SECTIONS.find((s) => s.id === value)?.id ?? "overview";
}
export const sectionInfo = (id: NoteSection): SectionInfo => NOTE_SECTIONS.find((s) => s.id === id) ?? OVERVIEW;

/** The tabs for a set of notes: Overview first only when some of them are still in it. */
export function sectionsFor(notes: Pick<PresentationNote, "section">[]): SectionInfo[] {
  return notes.some((n) => noteSection(n.section) === "overview") ? [OVERVIEW, ...NOTE_SECTIONS] : NOTE_SECTIONS;
}

/** The section to open: the one asked for if it is shown, else the first with notes, else DDx. */
export function openingSection(requested: string | null, notes: Pick<PresentationNote, "section">[]): NoteSection {
  const shown = sectionsFor(notes);
  const asked = requested ? shown.find((s) => s.id === requested) : undefined;
  return asked?.id ?? shown.find((s) => notes.some((n) => noteSection(n.section) === s.id))?.id ?? "ddx";
}
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
    (note.section !== undefined && !NOTE_SECTIONS.some((s) => s.id === note.section)) ||
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
