import { expect, it, vi } from "vitest";
import type { JsonStore } from "../../netlify/lib/store";

/** An in-memory stand-in for the blob store, with the same update semantics. */
function memoryStore(): JsonStore & { blobs: Map<string, unknown> } {
  const blobs = new Map<string, unknown>();
  return {
    blobs,
    get: async (k) => blobs.get(k) ?? null,
    setJSON: async (k, v) => { blobs.set(k, JSON.parse(JSON.stringify(v))); },
    delete: async (k) => { blobs.delete(k); },
    list: async (prefix) => [...blobs.keys()].filter((k) => k.startsWith(prefix)),
    update: async <T,>(k: string, change: (c: T | null) => T | null | Promise<T | null>) => { const next = await change((blobs.get(k) as T) ?? null); if (next !== null) blobs.set(k, JSON.parse(JSON.stringify(next))); return next; },
  };
}
vi.mock("../../netlify/lib/store", () => ({ openNamedStore: () => memoryStore(), hosted: () => false }));
const { push, changes, fetchRecords, attemptRows, validPush, summarise, readIndex } = await import("../../netlify/lib/accountStore");

const attempt = (id: string, _m: number, extra: Record<string, unknown> = {}) => ({ id, _m, questionId: `q-${id}`, qref: { setId: "s", bankId: "bank-1", order: 2 }, answers: [{ label: "", text: "Aspirin", doc: null }], startedAt: 1, submittedAt: _m, elapsedSec: 5, mode: "practice", ...extra });

it("keeps what a device pushes, tells another device what changed, and hands the records over", async () => {
  const store = memoryStore();
  await push("u1", { attempts: [attempt("a1", 100)], settings: { id: "settings", _m: 120, minutesPerMark: 2 }, session: { id: "session", _m: 130, session: { id: "s" } }, marks: [], deletes: [] }, 1000, store);
  await push("u1", { attempts: [attempt("a2", 150)], marks: [{ id: "m1", _m: 160, attemptId: "a1", score: 2 }], deletes: [] }, 1100, store);
  const all = await changes("u1", 0, 1200, store);
  expect(all.entries.map((e) => `${e.table}:${e.id}@${e._m}`).sort()).toEqual(["attempts:a1@100", "attempts:a2@150", "marks:m1@160"]);
  expect(all.settings).toMatchObject({ minutesPerMark: 2 });
  expect(all.session).toMatchObject({ _m: 130 });
  // The next cursor sits a little before now, so nothing taken in while the reply was made is ever skipped.
  expect(all.next).toBe(1200 - 5000);
  // A device that pulled after the first push hears only of what arrived since (by the store's clock, whatever the
  // devices' clocks said), and nothing of settings or the paper.
  const later = await changes("u1", 1050, 1300, store);
  expect(later.entries.map((e) => e.id).sort()).toEqual(["a2", "m1"]);
  expect(later.settings).toBeUndefined();
  // A record stamped long ago by a slow device still arrives at everyone else.
  await push("u1", { attempts: [attempt("a0", 5)], marks: [], deletes: [] }, 1400, store);
  expect((await changes("u1", 1350, 1500, store)).entries.map((e) => e.id)).toEqual(["a0"]);
  const page = await fetchRecords("u1", later.entries.map((e) => ({ table: e.table, id: e.id })), undefined, store);
  expect(page.records.map((r) => r.record.id).sort()).toEqual(["a2", "m1"]);
  expect(page.remaining).toEqual([]);
  // A record nobody has is simply left out.
  expect((await fetchRecords("u1", [{ table: "attempts", id: "nope" }], undefined, store)).records).toEqual([]);
});

it("newest wins: an older copy from a lagging device never overwrites, and the index keeps the newest stamp", async () => {
  const store = memoryStore();
  await push("u1", { attempts: [attempt("a1", 200, { elapsedSec: 9 })], marks: [], deletes: [] }, 1000, store);
  await push("u1", { attempts: [attempt("a1", 150, { elapsedSec: 3 })], marks: [], deletes: [] }, 1001, store);
  const page = await fetchRecords("u1", [{ table: "attempts", id: "a1" }], undefined, store);
  expect(page.records[0].record.elapsedSec).toBe(9);
  expect((await readIndex("u1", store))?._m).toBe(200);
  // Settings and the paper follow their own stamps the same way.
  await push("u1", { attempts: [], marks: [], settings: { id: "settings", _m: 50, minutesPerMark: 1 }, deletes: [] }, 1002, store);
  await push("u1", { attempts: [], marks: [], settings: { id: "settings", _m: 40, minutesPerMark: 7 }, deletes: [] }, 1003, store);
  expect((await changes("u1", 0, 1004, store)).settings).toMatchObject({ minutesPerMark: 1 });
});

it("a deletion is a tombstone other devices hear of; a record edited after it comes back", async () => {
  const store = memoryStore();
  await push("u1", { attempts: [attempt("a1", 100), attempt("a2", 100)], marks: [], deletes: [] }, 1000, store);
  await push("u1", { attempts: [], marks: [], deletes: [{ id: "a1", table: "attempts", at: 120 }] }, 1001, store);
  const ch = await changes("u1", 1000, 1002, store);
  expect(ch.entries).toEqual([{ id: "a1", table: "attempts", _m: 120, deleted: true }]);
  expect(store.blobs.has("u1/attempts/a1")).toBe(false);
  // A stale device re-pushing the deleted record (older stamp) does not bring it back...
  await push("u1", { attempts: [attempt("a1", 100)], marks: [], deletes: [] }, 1003, store);
  expect(store.blobs.has("u1/attempts/a1")).toBe(false);
  // ...but an edit made after the deletion does.
  await push("u1", { attempts: [attempt("a1", 130)], marks: [], deletes: [] }, 1004, store);
  expect((await changes("u1", 1003, 1005, store)).entries).toEqual([{ id: "a1", table: "attempts", _m: 130 }]);
  // A deletion older than the record's last edit is ignored.
  await push("u1", { attempts: [], marks: [], deletes: [{ id: "a2", table: "attempts", at: 90 }] }, 1006, store);
  expect(store.blobs.has("u1/attempts/a2")).toBe(true);
});

it("hands records over a page at a time when they do not all fit one call", async () => {
  const store = memoryStore();
  const big = (id: string) => attempt(id, 100, { answers: [{ label: "", text: "x".repeat(600), doc: null }] });
  await push("u1", { attempts: [big("a1"), big("a2"), big("a3")], marks: [], deletes: [] }, 1000, store);
  const keys = ["a1", "a2", "a3"].map((id) => ({ table: "attempts" as const, id }));
  const first = await fetchRecords("u1", keys, 1700, store);
  expect(first.records.map((r) => r.record.id)).toEqual(["a1", "a2"]);
  expect(first.remaining).toEqual([{ table: "attempts", id: "a3" }]);
  // Keys past one call's share come straight back, never dropped.
  const many = Array.from({ length: 450 }, (_, i) => ({ table: "attempts" as const, id: i < 3 ? `a${i + 1}` : `none-${i}` }));
  const capped = await fetchRecords("u1", many, undefined, store);
  expect(capped.records.map((r) => r.record.id)).toEqual(["a1", "a2", "a3"]);
  expect(capped.remaining).toEqual(many.slice(400));
  const second = await fetchRecords("u1", first.remaining, 1700, store);
  expect(second.records.map((r) => r.record.id)).toEqual(["a3"]);
  // One record alone always fits, however large, so a pull can never stall.
  expect((await fetchRecords("u1", [keys[0]], 10, store)).records).toHaveLength(1);
});

it("the index carries what the board count needs, so no record is read for it", async () => {
  const store = memoryStore();
  const blank = attempt("b1", 300, { answers: [{ label: "", text: "  ", doc: null }] });
  const picture = attempt("p1", 310, { answers: [{ label: "", text: "", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "data:," } }] }] } }] });
  const draft = attempt("d1", 320, { submittedAt: undefined });
  await push("u1", { attempts: [attempt("a1", 100), blank, picture, draft], marks: [], deletes: [] }, 1000, store);
  expect(summarise("attempts", blank as never)).toMatchObject({ e: true, s: 300 });
  expect(summarise("attempts", picture as never).e).toBeUndefined();
  expect(summarise("marks", { id: "m" })).toEqual({});
  const rows = await attemptRows("u1", 0, store);
  expect(rows?.imported).toBe(false);
  expect(rows?.rows.map((r) => r.id).sort()).toEqual(["a1", "p1"]);
  expect(rows?.rows[0].row).toEqual({ uid: "u1", submittedAt: 100, questionId: "q-a1", bankId: "bank-1", order: 2 });
  expect((await attemptRows("u1", 305, store))?.rows.map((r) => r.id)).toEqual(["p1"]);
  expect(await attemptRows("nobody", 0, store)).toBeNull();
});

it("refuses bodies that are not records", () => {
  expect(validPush(null)).toBeNull();
  expect(validPush({ attempts: [{ _m: 1 }] })).toBeNull();
  expect(validPush({ attempts: [{ id: "a/b", _m: 1 }] })).toBeNull();
  // Ids minted by older versions of the app pass whatever they look like, short of the key separator.
  expect(validPush({ marks: [{ id: "mark-2024:bank:x.y", _m: 1 }] })?.marks).toHaveLength(1);
  expect(validPush({ deletes: [{ id: "x", table: "notes", at: 1 }] })).toBeNull();
  expect(validPush({ attempts: [{ id: "a1", _m: 1 }], deletes: [{ id: "m1", table: "marks", at: 2 }] })).toEqual({ attempts: [{ id: "a1", _m: 1 }], marks: [], deletes: [{ id: "m1", table: "marks", at: 2 }] });
  expect(validPush({})).toEqual({ attempts: [], marks: [], deletes: [] });
});

it("keeps a record whole: comments, replies, revisions, highlights and marks come back exactly as sent", async () => {
  const store = memoryStore();
  const full = {
    id: "a9", _m: 900, ownerId: "u1", questionId: "q9", qref: { setId: "s", bankId: "b", order: 3, text: "Q", setName: "Set 09", setNumber: 9 },
    answers: [{ label: "a", text: "Aspirin and PCI", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Aspirin and PCI", marks: [{ type: "bold" }] }] }] }, flagged: true, revision: { doc: { type: "doc", content: [] }, text: "aspirin 300 mg and PCI", at: 950 } }],
    startedAt: 1, submittedAt: 2, elapsedSec: 3, timerLimitSec: 600, mode: "practice", sessionId: "paper", confidence: 2,
    answerComments: [
      { id: "c1", partLabel: "a", start: 0, end: 7, quote: "Aspirin", text: "Dose?", by: "me", createdAt: 10, updatedAt: 12 },
      { id: "c2", partLabel: "a", start: 0, end: 0, quote: "", text: "300 mg, then PCI within 120 minutes", by: "marker", replyTo: "c1", createdAt: 20, updatedAt: 20 },
    ],
    stemHighlights: [{ stem: 0, start: 4, end: 9 }],
  };
  const mark = { id: "m9", _m: 901, ownerId: "u1", attemptId: "a9", questionId: "q9", score: 2.5, maxScore: 4, parts: [{ label: "a", score: 2.5, maxScore: 4, feedback: "Add the timing.", pointsHit: ["Aspirin"], rewrite: "Aspirin 300 mg…" }], errorTags: ["omission"], notes: "Good", learningPoint: "Door-to-balloon", reviewLater: false, markedAt: 30 };
  await push("u1", { attempts: [full], marks: [mark], deletes: [] }, 1000, store);
  const got = await fetchRecords("u1", [{ table: "attempts", id: "a9" }, { table: "marks", id: "m9" }], undefined, store);
  expect(got.records.find((r) => r.table === "attempts")?.record).toEqual(full);
  expect(got.records.find((r) => r.table === "marks")?.record).toEqual(mark);
  // Nothing is ever dropped without a deletion being pushed: the index lists both, neither as deleted.
  expect((await changes("u1", 0, 1001, store)).entries.map((e) => [e.id, e.deleted])).toEqual([["a9", undefined], ["m9", undefined]]);
});

it("a record and its own older deletion in one push: the record is kept, blob and index alike", async () => {
  const store = memoryStore();
  await push("u1", { attempts: [attempt("x", 100)], marks: [], deletes: [{ id: "x", table: "attempts", at: 50 }] }, 1000, store);
  expect(store.blobs.has("u1/attempts/x")).toBe(true);
  expect((await changes("u1", 0, 1001, store)).entries).toEqual([{ id: "x", table: "attempts", _m: 100 }]);
  expect((await fetchRecords("u1", [{ table: "attempts", id: "x" }], undefined, store)).records).toHaveLength(1);
  // The other way round, the deletion is the later word and wins.
  await push("u1", { attempts: [attempt("y", 40)], marks: [], deletes: [{ id: "y", table: "attempts", at: 60 }] }, 1002, store);
  expect(store.blobs.has("u1/attempts/y")).toBe(false);
  expect((await changes("u1", 1001, 1003, store)).entries).toEqual([{ id: "y", table: "attempts", _m: 60, deleted: true }]);
});
