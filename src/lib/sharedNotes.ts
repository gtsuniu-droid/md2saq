import { db, getSettings } from "../data/db";
import type { PresentationNote } from "../data/types";
import { PRESENTATION_BY_ID } from "../data/presentations";
import { MAX_SHARED_NOTE_BYTES, noteIsNewer, validateNote } from "./noteModel";
export const SHARED_OWNER = "@shared";
async function responseJson(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Shared library is unavailable. Your saved copy is still available.");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not reach the shared library.");
  return body;
}
const INDEX_KEY = "sharedNotes.index";
export async function getSharedNotesIndex(): Promise<string[]> {
  const value = (await db.meta.get(INDEX_KEY))?.value;
  if (typeof value !== "string") return [];
  try { const ids = JSON.parse(value); return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && PRESENTATION_BY_ID.has(id)) : []; } catch { return []; }
}
let indexRefresh: Promise<void> | null = null;
/** A small availability index, fetched on entry or manual refresh, never on a timer. */
export function refreshSharedNotesIndex(): Promise<void> {
  if (indexRefresh) return indexRefresh;
  indexRefresh = (async () => {
    const body = await responseJson(await fetch("/api/notes?index=1", { cache: "no-store" }));
    if (!Array.isArray(body.presentations) || body.presentations.some((id: unknown) => typeof id !== "string" || !PRESENTATION_BY_ID.has(id))) throw new Error("Could not load the shared library index. Your saved notes are still available.");
    await db.meta.put({ id: INDEX_KEY, value: JSON.stringify([...new Set(body.presentations)]) });
  })().finally(() => { indexRefresh = null; });
  return indexRefresh;
}
export async function refreshSharedNotes(presentation: string): Promise<void> {
  const body = await responseJson(await fetch(`/api/notes?presentation=${encodeURIComponent(presentation)}`, { cache: "no-store" }));
  if (!Array.isArray(body.notes)) throw new Error("Invalid shared library response.");
  const notes: PresentationNote[] = body.notes;
  for (const n of notes) { validateNote(n); if (n.ownerId !== SHARED_OWNER || n.presentationId !== presentation || !n.id.startsWith("shared-")) throw new Error("Invalid shared note."); }
  await db.transaction("rw", db.notes, async () => {
    for (const n of notes) {
      const previous = await db.notes.get(n.id);
      if (!previous || (previous.ownerId === SHARED_OWNER && noteIsNewer(n, previous))) await db.notes.put(n);
    }
  });
}
export async function saveSharedNote(note: PresentationNote): Promise<PresentationNote> {
  validateNote(note, MAX_SHARED_NOTE_BYTES);
  const passcode = (await getSettings()).bankPasscode;
  if (!passcode) throw new Error("Unlock Admin in Settings to edit shared notes.");
  const body = await responseJson(await fetch(`/api/notes?presentation=${encodeURIComponent(note.presentationId)}`, {
    method: "PUT", headers: { "content-type": "application/json", "x-passcode": passcode }, body: JSON.stringify({ note, baseRevision: note.revision || undefined }),
  }));
  validateNote(body.note);
  await db.notes.put(body.note);
  return body.note;
}
