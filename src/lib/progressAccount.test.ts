import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import type { Attempt, Mark, Question, Session } from "../data/types";
import { historyEntries } from "./history";
import { setProgressAccount } from "./progressAccount";
import { loadSession, saveSession, sessionOwner } from "./session";
import { getProgressSyncState, questionRef, syncNow } from "./sync";
import { fetchSince, writeMany } from "./firebase";
import { importAll, exportAll } from "./exportImport";

vi.mock("./firebase", () => ({ cloudConfigured: () => true, currentUser: vi.fn(), writeMany: vi.fn(), fetchSince: vi.fn(), deleteMany: vi.fn() }));
vi.mock("./notes", () => ({ syncNotes: vi.fn().mockResolvedValue(undefined) }));
const cloud = new Map<string, Map<string, Record<string, unknown>>>();
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() };
}
const q: Question = { id: "q", setId: "set", order: 0, text: "Describe your approach", parts: [], tags: [], presentations: [], createdAt: 1 };
const attempt = (id: string, ownerId: string): Attempt => ({ id, ownerId, questionId: "q", qref: { setId: "set", bankId: "bank", order: 0, text: q.text, setNumber: 1 }, answers: [{ label: "", text: "My answer", doc: { type: "doc", content: [] } }], startedAt: 10, submittedAt: 20, elapsedSec: 5, mode: "practice", sessionId: `paper-${id}` });
const mark = (id: string, ownerId: string): Mark => ({ id: `mark-${id}`, ownerId, attemptId: id, questionId: "q", qref: { setId: "set", bankId: "bank", order: 0 }, score: 2, maxScore: 3, parts: [], errorTags: [], markedAt: 30 });
const session = (id: string): Session => ({ id: `paper-${id}`, questionIds: ["q"], attemptIds: [id], index: 0, mode: "practice", startedAt: 10 });
let now = 10_000;
beforeEach(async () => {
  vi.stubGlobal("localStorage", storage()); vi.stubGlobal("sessionStorage", storage());
  vi.spyOn(Date, "now").mockImplementation(() => ++now);
  await Promise.all(db.tables.map((table) => table.clear()));
  cloud.clear(); vi.mocked(writeMany).mockReset(); vi.mocked(fetchSince).mockReset();
  vi.mocked(writeMany).mockImplementation(async (uid, collection, docs) => {
    const key = `${uid}/${collection}`;
    const bucket = cloud.get(key) ?? new Map<string, Record<string, unknown>>();
    for (const doc of docs) bucket.set(String(doc.id), structuredClone(doc));
    cloud.set(key, bucket);
  });
  vi.mocked(fetchSince).mockImplementation(async (uid, collection, since) => [...(cloud.get(`${uid}/${collection}`)?.values() ?? [])].filter((doc) => Number(doc._m) > since).map((doc) => structuredClone(doc)));
  await db.sets.put({ id: "set", name: "Case", number: 1, bankId: "bank", createdAt: 1 });
  await db.questions.put(q);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("account-owned progress and cloud history", () => {
  it("keeps answers, marks, cursors and unfinished sessions separate when switching accounts", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.attempts.put(attempt("a", "alice")); await db.marks.put(mark("a", "alice"));
    saveSession(session("a")); await syncNow({ uid: "alice" });
    await setProgressAccount({ uid: "bob" });
    expect(loadSession()).toBeNull();
    await db.attempts.put(attempt("b", "bob")); await db.marks.put(mark("b", "bob"));
    saveSession(session("b")); await syncNow({ uid: "bob" });
    expect([...cloud.get("alice/attempts")!.keys()]).toEqual(["a"]);
    expect([...cloud.get("bob/attempts")!.keys()]).toEqual(["b"]);
    expect([...cloud.get("bob/marks")!.keys()]).toEqual(["mark-b"]);
    expect(cloud.get("bob/settings")!.get("session")?.session).toMatchObject({ id: "paper-b" });
    expect(await db.meta.get("sync.pulledAt:alice")).toBeDefined();
    expect(await db.meta.get("sync.pulledAt:bob")).toBeDefined();
    await setProgressAccount(null); expect(loadSession()).toBeNull();
    expect(historyEntries(await db.attempts.toArray(), await db.marks.toArray(), [q], [], "")).toEqual([]);
    await setProgressAccount({ uid: "alice" }); expect(loadSession()?.id).toBe("paper-a");
    const rows = historyEntries(await db.attempts.toArray(), await db.marks.toArray(), [q], [], "alice");
    expect(rows.map((r) => r.attempt.id)).toEqual(["a"]);
    expect(rows[0].mark?.score).toBe(2);
  });
  it("claims guest work once and retains a legacy paper for its previous account", async () => {
    await db.attempts.put(attempt("guest", ""));
    saveSession(session("guest"));
    await setProgressAccount({ uid: "alice" });
    expect((await db.attempts.get("guest"))?.ownerId).toBe("alice");
    expect(loadSession()?.id).toBe("paper-guest");
    await setProgressAccount({ uid: "bob" });
    expect((await db.attempts.get("guest"))?.ownerId).toBe("alice");
    expect(loadSession()).toBeNull();
  });
  it("migrates an existing global paper to the account stored on the device before switching", async () => {
    localStorage.setItem("saq-session-v2", JSON.stringify({ session: session("legacy"), _m: 40 }));
    await db.settings.put({ id: "settings", minutesPerMark: 1, autoImportBank: false, ambossHighlights: false, ambossOnPaper: false, cloudUser: { uid: "alice" } });
    // The first render may read the old envelope before authentication finishes.
    expect(loadSession()?.id).toBe("paper-legacy");
    await setProgressAccount({ uid: "bob" });
    expect(loadSession()).toBeNull();
    expect(loadSession("alice")?.id).toBe("paper-legacy");
    expect(sessionOwner()).toBe("bob");
  });
  it("restores history, marks and the paper on another device with different question ids", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.attempts.put({ ...attempt("a", "alice"), qref: await questionRef(q) }); await db.marks.put(mark("a", "alice"));
    saveSession({ ...session("a"), studyUnit: "sets", openedSetCount: 2 }); await syncNow({ uid: "alice" });
    await Promise.all([db.attempts.clear(), db.marks.clear(), db.meta.clear(), db.settings.clear(), db.questions.clear()]);
    localStorage.clear();
    await db.questions.put({ ...q, id: "q-on-new-device" });
    await setProgressAccount({ uid: "alice" }); await syncNow({ uid: "alice" });
    expect((await db.attempts.get("a"))?.questionId).toBe("q-on-new-device");
    expect((await db.attempts.get("a"))?.answers[0].text).toBe("My answer");
    expect((await db.marks.get("mark-a"))?.ownerId).toBe("alice");
    expect(loadSession()?.questionIds).toEqual(["q-on-new-device"]);
    expect(loadSession()).toMatchObject({ studyUnit: "sets", openedSetCount: 2 });
  });
  it("retains history before its bank arrives and resolves it on the next sync", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.questions.clear();
    cloud.set("alice/attempts", new Map([["remote", { ...attempt("remote", "alice"), _m: 100 }]]));
    expect((await syncNow({ uid: "alice" }))?.unresolved).toBe(1);
    expect((await db.attempts.get("remote"))?.submittedAt).toBe(20);
    expect(await db.meta.get("sync.pulledAt:alice")).toBeUndefined();
    await db.questions.put({ ...q, id: "downloaded" });
    expect((await syncNow({ uid: "alice" }))?.unresolved).toBe(0);
    expect((await db.attempts.get("remote"))?.questionId).toBe("downloaded");
  });
  it("keeps offline attempts and retries failed cloud writes without advancing the cursor", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.attempts.put(attempt("a", "alice"));
    vi.mocked(writeMany).mockRejectedValueOnce(new Error("Offline"));
    await expect(syncNow({ uid: "alice" })).rejects.toThrow("Offline");
    expect(getProgressSyncState().status).toBe("error");
    expect(await db.meta.get("sync.pushedAt:alice")).toBeUndefined();
    expect(await db.attempts.get("a")).toBeDefined();
    await syncNow({ uid: "alice" });
    expect(cloud.get("alice/attempts")?.has("a")).toBe(true);
    expect(getProgressSyncState().status).toBe("synced");
  });
  it("preserves a guest paper when the signed-in account already has one", async () => {
    await setProgressAccount({ uid: "alice" });
    saveSession(session("a"));
    await setProgressAccount(null);
    await db.attempts.put(attempt("guest", ""));
    await db.marks.put(mark("guest", ""));
    saveSession(session("guest"));
    await setProgressAccount({ uid: "alice" });
    expect(loadSession()?.id).toBe("paper-a");
    expect((await db.attempts.get("guest"))?.ownerId).toBe("");
    expect((await db.marks.get("mark-guest"))?.ownerId).toBe("");
    await setProgressAccount(null);
    expect(loadSession()?.id).toBe("paper-guest");
  });
  it("imports a backup into another account without replacing the original account's answers", async () => {
    await setProgressAccount({ uid: "alice" });
    await db.attempts.put(attempt("a", "alice")); await db.marks.put(mark("a", "alice"));
    const backup = await exportAll();
    await setProgressAccount({ uid: "bob" });
    await importAll(backup);
    expect((await db.attempts.get("a"))?.ownerId).toBe("alice");
    expect((await db.marks.get("mark-a"))?.ownerId).toBe("alice");
    const bobBackup = await exportAll();
    expect(bobBackup.attempts).toHaveLength(1);
    expect(bobBackup.attempts[0].id).not.toBe("a");
    expect(bobBackup.marks[0].attemptId).toBe(bobBackup.attempts[0].id);
  });
  it("syncs concurrent account requests into their own cloud records", async () => {
    await db.attempts.bulkPut([attempt("a", "alice"), attempt("b", "bob")]);
    await Promise.all([syncNow({ uid: "alice" }), syncNow({ uid: "bob" }), syncNow({ uid: "alice" })]);
    expect([...cloud.get("alice/attempts")!.keys()]).toEqual(["a"]);
    expect([...cloud.get("bob/attempts")!.keys()]).toEqual(["b"]);
    expect(vi.mocked(writeMany).mock.calls.filter(([uid, collection]) => uid === "alice" && collection === "attempts")).toHaveLength(1);
  });
});
