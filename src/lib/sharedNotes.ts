import { db, getSettings } from "../data/db";
import type { PresentationNote } from "../data/types";
import { MAX_SHARED_NOTE_BYTES, noteIsNewer, validateNote } from "./noteModel";
export const SHARED_OWNER = "@shared";
async function responseJson(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Shared library is unavailable. Your saved copy is still available.");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not reach the shared library.");
  return body;
}
export async function refreshSharedNotes(presentation: string): Promise<void> {
  const body = await responseJson(await fetch(`/api/notes?presentation=${encodeURIComponent(presentation)}`));
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
