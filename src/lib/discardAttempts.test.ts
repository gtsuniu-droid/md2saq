import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { db } from "../data/db";
import type { Attempt, Mark } from "../data/types";

vi.mock("./sync", () => ({ recordDeletes: vi.fn(async () => undefined), requestSync: vi.fn() }));
const session = { current: null as Record<string, unknown> | null };
vi.mock("./session", () => ({ loadSession: () => session.current, saveSession: (s: Record<string, unknown> | null) => { session.current = s; } }));
const { discardAttempts } = await import("./discardAttempts");
const { recordDeletes } = await import("./sync");

const attempt = (id: string): Attempt => ({ id, ownerId: "me", questionId: `q-${id}`, answers: [{ label: "", text: "", doc: null }], startedAt: 1, submittedAt: 2, elapsedSec: 1, mode: "practice" });
const mark = (id: string, attemptId: string): Mark => ({ id, ownerId: "me", attemptId, questionId: `q-${attemptId}`, score: 0, maxScore: 3, parts: [], errorTags: [], markedAt: 3 });

beforeEach(async () => {
  await Promise.all([db.attempts.clear(), db.marks.clear()]);
  await db.attempts.bulkAdd([attempt("a1"), attempt("a2"), attempt("b1")]);
  await db.marks.bulkAdd([mark("m1", "a1"), mark("m2", "b1")]);
  vi.mocked(recordDeletes).mockClear();
  session.current = { id: "s", attemptIds: ["a1", "a2", "b1"], questionIds: ["q-a1", "q-a2", "q-b1"], index: 2, openedSetCount: 2 };
});

it("removes a sitting's attempts and marks, tells the account, and takes them out of the live session", async () => {
  await discardAttempts(["a1", "a2"], "me");
  expect((await db.attempts.toArray()).map((a) => a.id)).toEqual(["b1"]);
  expect((await db.marks.toArray()).map((m) => m.id)).toEqual(["m2"]);
  expect(vi.mocked(recordDeletes).mock.calls).toEqual([["attempts", ["a1", "a2"]], ["marks", ["m1"]]]);
  expect(session.current).toMatchObject({ attemptIds: ["b1"], questionIds: ["q-b1"], index: 0, openedSetCount: 1 });
});

it("ends a session that has nothing left, and does nothing for no ids", async () => {
  await discardAttempts(["a1", "a2", "b1"], "me");
  expect(session.current).toBeNull();
  await discardAttempts([], "me");
  expect(vi.mocked(recordDeletes)).toHaveBeenCalledTimes(2);
});
