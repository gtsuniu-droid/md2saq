import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db } from "../data/db";
import { DEFAULT_SETTINGS, type Mark } from "../data/types";
import { saveMarking } from "./saveMarking";
const mark: Mark = { id: "m", attemptId: "a", ownerId: "alice", questionId: "q", score: 0, maxScore: 0, parts: [{ label: "", score: 2, maxScore: 3, pointsHit: [] }], errorTags: [], notes: "Remember to explain the next step", reviewLater: true, markedAt: 2 };
beforeEach(async () => {
  await Promise.all([db.settings.clear(), db.attempts.clear(), db.marks.clear()]);
  await db.settings.put({ ...DEFAULT_SETTINGS, cloudUser: { uid: "alice" } });
  await db.attempts.put({ id: "a", ownerId: "alice", questionId: "q", answers: [], startedAt: 1, submittedAt: 2, elapsedSec: 10, mode: "practice" });
});
it("saves personal notes and review reminders with the score and sync timestamp", async () => {
  await saveMarking(mark, 4);
  expect(await db.marks.get("m")).toMatchObject({ ownerId: "alice", notes: mark.notes, reviewLater: true, score: 2, maxScore: 3 });
  expect((await db.marks.get("m"))?._m).toBeGreaterThan(0);
  expect((await db.attempts.get("a"))?.confidence).toBe(4);
  await saveMarking({ ...mark, reviewLater: false, notes: "Updated notes" });
  expect(await db.marks.count()).toBe(1);
  expect((await db.marks.get("m"))?.reviewLater).toBe(false);
});
it("rejects invalid scores before changing either saved record", async () => {
  await expect(saveMarking({ ...mark, parts: [{ label: "", score: 4, maxScore: 3, pointsHit: [] }] }, 4)).rejects.toThrow("maximum");
  expect(await db.marks.count()).toBe(0);
  expect((await db.attempts.get("a"))?.confidence).toBeUndefined();
});
it("protects private marking after an account switch and refuses unsubmitted attempts", async () => {
  await db.settings.update("settings", { cloudUser: { uid: "bob" } });
  await expect(saveMarking(mark)).rejects.toThrow("account changed");
  await db.settings.update("settings", { cloudUser: { uid: "alice" } });
  await db.attempts.update("a", { submittedAt: undefined });
  await expect(saveMarking(mark)).rejects.toThrow("submitted attempt");
  expect(await db.marks.count()).toBe(0);
});
it("automatically flags answer-assisted attempts even when the caller did not flag them", async () => {
  await saveMarking({ ...mark, reviewLater: false, lookedAtAnswer: true });
  expect(await db.marks.get("m")).toMatchObject({ lookedAtAnswer: true, reviewLater: true });
});

it("saves all questions in a set together, preserving each question's notes", async () => {
  await db.attempts.put({ id: "b", ownerId: "alice", questionId: "q2", answers: [], startedAt: 1, submittedAt: 2, elapsedSec: 10, mode: "practice" });
  const { saveSetMarking } = await import("./saveMarking");
  await saveSetMarking([{ mark }, { mark: { ...mark, id: "m2", attemptId: "b", questionId: "q2", notes: "Second answer notes", lookedAtAnswer: true } }]);
  expect(await db.marks.count()).toBe(2);
  expect(await db.marks.get("m2")).toMatchObject({ questionId: "q2", notes: "Second answer notes", lookedAtAnswer: true, reviewLater: true });
});
it("rolls back the entire set if a later attempt disappears or belongs to another account", async () => {
  const { saveSetMarking } = await import("./saveMarking");
  await expect(saveSetMarking([{ mark, confidence: 4 }, { mark: { ...mark, id: "m2", attemptId: "missing" } }])).rejects.toThrow("submitted attempt");
  expect(await db.marks.count()).toBe(0);
  expect((await db.attempts.get("a"))?.confidence).toBeUndefined();
  await db.attempts.put({ id: "private", ownerId: "bob", questionId: "q2", answers: [], startedAt: 1, submittedAt: 2, elapsedSec: 0, mode: "practice" });
  await expect(saveSetMarking([{ mark }, { mark: { ...mark, id: "m2", attemptId: "private" } }])).rejects.toThrow("submitted attempt");
  expect(await db.marks.count()).toBe(0);
});
