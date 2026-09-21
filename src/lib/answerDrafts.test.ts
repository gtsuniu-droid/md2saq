import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import { clearAnswerDraft, recoverAnswerDrafts, writeAnswerDraft } from "./answerDrafts";

beforeEach(async () => {
  const values: Record<string, string> = {};
  vi.stubGlobal("localStorage", new Proxy({
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  }, { ownKeys: () => Object.keys(values), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) }));
  await db.attempts.clear();
  await db.attempts.put({ id: "a", sessionId: "s", questionId: "q", answers: [], startedAt: 1, elapsedSec: 0, mode: "practice" });
});
const answers = [{ label: "a", doc: null, text: "My unsaved answer" }];
describe("answer recovery", () => {
  it("recovers the most recent answer after a page closes before autosave", async () => {
    writeAnswerDraft("s", "a", answers);
    await recoverAnswerDrafts("s");
    expect((await db.attempts.get("a"))?.answers).toEqual(answers);
    expect(Object.keys(localStorage)).toHaveLength(0);
  });
  it("does not clear a newer keystroke when an older save finishes", () => {
    writeAnswerDraft("s", "a", answers);
    clearAnswerDraft("a", []);
    expect(Object.keys(localStorage)).toHaveLength(1);
    clearAnswerDraft("a", answers);
    expect(Object.keys(localStorage)).toHaveLength(0);
  });
  it("does not restore over a submitted answer or another session", async () => {
    writeAnswerDraft("s", "a", answers);
    await recoverAnswerDrafts("other");
    expect((await db.attempts.get("a"))?.answers).toEqual([]);
    await db.attempts.update("a", { submittedAt: Date.now() });
    await recoverAnswerDrafts("s");
    expect((await db.attempts.get("a"))?.answers).toEqual([]);
  });
});
