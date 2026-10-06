import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mark } from "../data/types";
import type { MarkingDraft } from "./markingSet";
import { clearMarkingDraft, loadMarkingDraft, writeMarkingDraft } from "./markingDrafts";

const draft: MarkingDraft = {
  parts: [{ label: "a", score: 2, maxScore: 3, pointsHit: [] }],
  errorTags: ["knowledge-gap"], learningPoint: "Remember this", notes: "Unfinished personal note",
  reviewLater: true, lookedAtAnswer: false, confidence: 3,
};
const mark: Mark = {
  id: "mark", attemptId: "attempt", questionId: "question", ownerId: "alice",
  score: 1, maxScore: 3, parts: [{ label: "a", score: 1, maxScore: 3, pointsHit: [] }],
  errorTags: [], markedAt: 100,
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("marking draft recovery", () => {
  it("recovers every marking field after leaving or reloading, without changing the saved mark", () => {
    expect(writeMarkingDraft("alice", "attempt", "question", draft, mark)).toBe(true);
    expect(loadMarkingDraft("alice", "attempt", "question", mark)).toEqual(draft);
    expect(mark.score).toBe(1);
    expect(mark.parts[0].score).toBe(1);
    expect(mark.notes).toBeUndefined();
  });

  it("keeps accounts, attempts and question identities separate", () => {
    writeMarkingDraft("alice", "attempt", "question", draft);
    expect(loadMarkingDraft("bob", "attempt", "question")).toBeNull();
    expect(loadMarkingDraft("", "attempt", "question")).toBeNull();
    expect(loadMarkingDraft("alice", "another-attempt", "question")).toBeNull();
    expect(loadMarkingDraft("alice", "attempt", "another-question")).toBeNull();
    expect(loadMarkingDraft("alice", "attempt", "question")).toEqual(draft);
  });

  it("does not restore an old draft over a newer saved score", () => {
    writeMarkingDraft("alice", "attempt", "question", draft, mark);
    expect(loadMarkingDraft("alice", "attempt", "question", { ...mark, markedAt: 101 })).toBeNull();
    expect(loadMarkingDraft("alice", "attempt", "question", { ...mark, id: "replacement" })).toBeNull();
    writeMarkingDraft("alice", "attempt", "question", draft);
    expect(loadMarkingDraft("alice", "attempt", "question", mark)).toBeNull();
  });

  it("retains a draft when only the review schedule has updated", () => {
    writeMarkingDraft("alice", "attempt", "question", draft, mark);
    expect(loadMarkingDraft("alice", "attempt", "question", { ...mark, _m: 500 })).toEqual(draft);
  });

  it("clears the saved draft without clearing newer edits or another account", () => {
    const newer = { ...draft, notes: "A newer note" };
    writeMarkingDraft("alice", "attempt", "question", newer);
    writeMarkingDraft("bob", "attempt", "question", draft);
    clearMarkingDraft("alice", "attempt", draft);
    expect(loadMarkingDraft("alice", "attempt", "question")).toEqual(newer);
    clearMarkingDraft("alice", "attempt", newer);
    expect(loadMarkingDraft("alice", "attempt", "question")).toBeNull();
    expect(loadMarkingDraft("bob", "attempt", "question")).toEqual(draft);
  });

  it("handles broken storage without crashing and reports failed draft writes", () => {
    vi.spyOn(localStorage, "getItem").mockReturnValue("not JSON");
    expect(loadMarkingDraft("alice", "attempt", "question")).toBeNull();
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ questionId: "question", markId: null, markedAt: null, draft: { ...draft, parts: [null] } }));
    expect(loadMarkingDraft("alice", "attempt", "question")).toBeNull();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    expect(writeMarkingDraft("alice", "attempt", "question", draft)).toBe(false);
  });
});
