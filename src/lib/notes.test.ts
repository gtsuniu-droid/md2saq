import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import type { PresentationNote } from "../data/types";
import { noteIsNewer, noteSection, validateNote } from "./noteModel";
import { saveNote, syncNotes } from "./notes";
import { fetchNotes, reconcileNote } from "./firebase";
import { exportAll, importAll } from "./exportImport";
vi.mock("./firebase", () => ({ currentUser: vi.fn(async () => null), fetchNotes: vi.fn(async () => []), reconcileNote: vi.fn(async (_uid, note) => note) }));
const note = (changes: Partial<PresentationNote> = {}): PresentationNote => ({ id: "n1", presentationId: "abdominal-pain", title: "Approach", kind: "Lecture Notes", doc: { type: "doc", content: [{ type: "paragraph" }] }, text: "", source: "", ownerId: "alice", createdAt: 1, _m: 10, revision: "a", deleted: false, ...changes });
beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.settings.clear()]);
  vi.mocked(fetchNotes).mockReset().mockResolvedValue([]);
  vi.mocked(reconcileNote).mockReset().mockImplementation(async (_uid, n) => n);
});
describe("presentation notes", () => {
  it("keeps legacy notes in Overview and preserves clinical sections through backup", async () => {
    expect(noteSection(note().section)).toBe("overview");
    expect(noteSection("invalid-link")).toBe("overview");
    expect(() => validateNote(note({ section: "other" as never }))).toThrow();
    const saved = await saveNote(note({ ownerId: "", section: "ddx" }));
    const backup = await exportAll();
    expect(backup.notes?.[0].section).toBe("ddx");
    await db.notes.delete(saved.id);
    await importAll(backup);
    expect((await db.notes.get(saved.id))?.section).toBe("ddx");
  });
  it("saves rich content and rejects a stale editor without discarding its data", async () => {
    const saved = await saveNote(note({ ownerId: "" }));
    expect((await db.notes.get("n1"))?.title).toBe("Approach");
    await expect(saveNote(note({ title: "Stale" }), "old-revision")).rejects.toThrow("changed on another device");
    expect((await db.notes.get("n1"))?.revision).toBe(saved.revision);
  });
  it("claims device notes for the account but never uploads another account's notes", async () => {
    await db.notes.bulkPut([note({ ownerId: "" }), note({ id: "bob-note", ownerId: "bob" })]);
    await syncNotes({ uid: "alice" });
    expect(reconcileNote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reconcileNote).mock.calls[0][1].ownerId).toBe("alice");
    expect((await db.notes.get("bob-note"))?.ownerId).toBe("bob");
  });
  it("pulls newer cloud edits and deletions without first overwriting them", async () => {
    await db.notes.put(note());
    vi.mocked(fetchNotes).mockResolvedValue([note({ _m: 20, revision: "b", deleted: true })]);
    await syncNotes({ uid: "alice" });
    expect(reconcileNote).not.toHaveBeenCalled();
    expect((await db.notes.get("n1"))?.deleted).toBe(true);
  });
  it("preserves edits made while a cloud transaction was in flight", async () => {
    await db.notes.put(note());
    vi.mocked(reconcileNote).mockImplementation(async (_uid, n) => {
      await db.notes.put(note({ _m: 30, revision: "c", title: "Typed during sync" }));
      return { ...n, _m: 20, revision: "b" };
    });
    await syncNotes({ uid: "alice" });
    expect((await db.notes.get("n1"))?.title).toBe("Typed during sync");
  });
  it("keeps failed uploads locally for a later retry", async () => {
    await db.notes.put(note());
    vi.mocked(reconcileNote).mockRejectedValue(new Error("Offline"));
    await expect(syncNotes({ uid: "alice" })).rejects.toThrow("Offline");
    expect(await db.notes.get("n1")).toEqual(note());
  });
  it("supports recoverable deletion and deterministic simultaneous revisions", async () => {
    const saved = await saveNote(note());
    const deleted = await saveNote({ ...saved, deleted: true }, saved.revision);
    expect(deleted.doc).toEqual(saved.doc);
    const restored = await saveNote({ ...deleted, deleted: false }, deleted.revision);
    expect(restored.deleted).toBe(false);
    expect(noteIsNewer(note({ revision: "z" }), note())).toBe(true);
  });
  it("backs up only the current account and restores notes from old and new backups", async () => {
    await db.notes.bulkPut([note({ ownerId: "" }), note({ id: "private", ownerId: "bob" })]);
    const backup = await exportAll();
    expect(backup.notes?.map((n) => n.id)).toEqual(["n1"]);
    await db.notes.delete("n1");
    expect((await importAll(backup)).notes).toBe(1);
    expect((await db.notes.get("n1"))?.title).toBe("Approach");
    const { notes: _notes, ...legacy } = backup;
    expect((await importAll(legacy)).notes).toBe(0);
  });
  it("rejects unknown presentations and oversized notes before persistence", () => {
    expect(() => validateNote(note({ presentationId: "not-a-presentation" }))).toThrow();
    expect(() => validateNote(note({ text: "x".repeat(800_000) }))).toThrow("too large");
  });
});
