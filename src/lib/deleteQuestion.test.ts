import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import { DEFAULT_SETTINGS } from "../data/types";
import { loadSession, saveSession } from "./session";
import { deleteQuestion, sessionWithout } from "./deleteQuestion";

const s = { questionIds: ["a", "b", "c"], attemptIds: ["1", "2", "3"], index: 2 };

describe("sessionWithout", () => {
  it("drops the question and its attempt, keeping the position sensible", () => {
    expect(sessionWithout(s, "b")).toEqual({ questionIds: ["a", "c"], attemptIds: ["1", "3"], index: 1 });
    expect(sessionWithout({ ...s, index: 0 }, "b")).toEqual({ questionIds: ["a", "c"], attemptIds: ["1", "3"], index: 0 });
    expect(sessionWithout(s, "c")?.index).toBe(1);
  });
  it("leaves a session alone when the question is not in it, and ends an emptied one", () => {
    expect(sessionWithout(s, "zzz")).toBe(s);
    expect(sessionWithout({ questionIds: ["a"], attemptIds: ["1"], index: 0 }, "a")).toBeNull();
    expect(sessionWithout(null, "a")).toBeNull();
  });
});

vi.mock("./session", () => ({ loadSession: vi.fn(), saveSession: vi.fn() }));
vi.mock("./sync", () => ({ recordDeletes: vi.fn() }));

describe("admin whole-question deletion", () => {
  beforeEach(async () => {
    await Promise.all([db.settings.clear(), db.questions.clear(), db.sets.clear(), db.attempts.clear(), db.marks.clear()]);
    await db.settings.put({ ...DEFAULT_SETTINGS, cloudUser: { uid: "admin", email: "gtsuniu@gmail.com" } });
    await db.sets.put({ id: "set", name: "Case", createdAt: 1 });
    await db.questions.bulkPut([0,1].map((order) => ({ id: `q${order}`, setId: "set", order, text: "Question", stems: ["Shared case stem"], parts: [{ label: "a", text: "Part" }], createdAt: 1, tags: [], presentations: [] })));
    await db.attempts.put({ id: "a0", questionId: "q0", ownerId: "admin", mode: "practice", answers: [], startedAt: 1, elapsedSec: 0 });
    await db.marks.put({ id: "m0", questionId: "q0", attemptId: "a0", ownerId: "admin", score: 0, maxScore: 1, parts: [], errorTags: [], markedAt: 2 });
    vi.mocked(loadSession).mockReturnValue({ id: "s", mode: "practice", questionIds: ["q0","q1"], attemptIds: ["a0","a1"], index: 0, startedAt: 1 });
  });
  it("removes only the chosen question and closes the session gap while keeping the other stem", async () => {
    expect(await deleteQuestion("q0")).toEqual({ setId: "set", remaining: 1 });
    expect(await db.questions.get("q0")).toBeUndefined();
    expect(await db.questions.get("q1")).toMatchObject({ order: 0, stems: ["Shared case stem"] });
    expect(await db.attempts.get("a0")).toBeUndefined();
    expect(await db.marks.get("m0")).toBeUndefined();
    expect(await db.sets.get("set")).toMatchObject({ dirty: true });
    expect(saveSession).toHaveBeenLastCalledWith(expect.objectContaining({ questionIds: ["q1"], attemptIds: ["a1"], index: 0 }));
  });
  it("blocks non-admin deletion before touching the library or attempts", async () => {
    await db.settings.update("settings", { cloudUser: { uid: "reader", email: "reader@example.com" } });
    await expect(deleteQuestion("q0")).rejects.toThrow("Only an admin");
    expect(await db.questions.count()).toBe(2);
    expect(await db.attempts.count()).toBe(1);
    expect(await db.marks.count()).toBe(1);
  });
});
