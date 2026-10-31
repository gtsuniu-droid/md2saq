import { db, newId } from "../data/db";
import type { PresentationNote } from "../data/types";
import type { CloudUser } from "./firebase";
import { validateNote } from "./noteModel";
import { syncNow } from "./sync";

export async function saveNote(note: PresentationNote, baseRevision?: string): Promise<PresentationNote> {
  const next = { ...note, title: note.title.trim(), kind: note.kind.trim(), _m: Math.max(Date.now(), note._m + 1), revision: newId() };
  validateNote(next);
  await db.transaction("rw", db.notes, async () => {
    const local = await db.notes.get(note.id);
    if (local && (local.ownerId !== note.ownerId || local.revision !== baseRevision)) {
      throw new Error("This note changed on another device. Copy your edits before reopening the latest version.");
    }
    await db.notes.put(next);
  });
  return next;
}

export type NotesSyncState = { status: "idle" | "syncing" | "synced" | "error"; message?: string; at?: number };
let state: NotesSyncState = { status: "idle" };
const listeners = new Set<() => void>();
export const getNotesSyncState = () => state;
export function subscribeNotesSync(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function report(next: NotesSyncState) { state = next; listeners.forEach((fn) => fn()); }

/**
 * Notes travel with the rest of the account (see sync.ts): a push sends the notes changed
 * since the last one, a pull brings down only what changed in the account, newest wins by
 * change stamp and revision. This is the Notes page's handle on that sync and its state.
 */
export async function syncNotes(user?: CloudUser | null): Promise<void> {
  report({ status: "syncing" });
  try {
    if (await syncNow(user) === null) { report({ status: "idle" }); return; }
    report({ status: "synced", at: Date.now() });
  } catch (e) {
    report({ status: "error", message: e instanceof Error ? e.message : "Could not sync notes. Your saved notes remain on this device." });
    throw e;
  }
}
