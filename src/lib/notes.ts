import { db, newId } from "../data/db";
import type { PresentationNote } from "../data/types";
import { currentUser, fetchNotes, reconcileNote, type CloudUser } from "./firebase";
import { noteIsNewer, validateNote } from "./noteModel";

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
const running = new Map<string, Promise<void>>();

/** Notes have their own account-scoped reconciliation, independent of question ids and legacy cursors. */
export async function syncNotes(user?: CloudUser | null): Promise<void> {
  const u = user ?? await currentUser();
  if (!u) return;
  const active = running.get(u.uid);
  if (active) return active;
  const job = (async () => {
    report({ status: "syncing" });
    try {
      await db.transaction("rw", db.notes, async () => {
        // Device-only notes join the first account used to sync them; existing account notes never move.
        await db.notes.where("ownerId").equals("").modify({ ownerId: u.uid });
      });
      const remote = new Map((await fetchNotes(u.uid)).map((n) => [n.id, n]));
      const local = await db.notes.where("ownerId").equals(u.uid).toArray();
      for (const note of local) {
        const cloud = remote.get(note.id);
        // A transaction rechecks the server before any write, so stale offline copies cannot overwrite it.
        remote.set(note.id, !cloud || noteIsNewer(note, cloud) ? await reconcileNote(u.uid, note) : cloud);
      }
      await db.transaction("rw", db.notes, async () => {
        for (const note of remote.values()) {
          validateNote(note);
          if (note.ownerId !== u.uid) continue;
          const latest = await db.notes.get(note.id);
          if (!latest || (latest.ownerId === u.uid && noteIsNewer(note, latest))) await db.notes.put(note);
        }
      });
      report({ status: "synced", at: Date.now() });
    } catch (e) {
      report({ status: "error", message: e instanceof Error ? e.message : "Could not sync notes. Your saved notes remain on this device." });
      throw e;
    }
  })();
  running.set(u.uid, job);
  try { await job; } finally { running.delete(u.uid); }
}
