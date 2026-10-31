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
  it("keeps pictures out of the recovery copy and puts back the ones already saved", async () => {
    const picture = (n: number) => "data:image/png;base64," + String(n).repeat(40_000);
    const image = (src: string) => ({ type: "image", attrs: { src, alt: "ECG" } });
    const doc = (...nodes: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content: nodes }] });
    const saved = [{ label: "a", doc: doc({ type: "text", text: "Seen" }, image(picture(1))), text: "Seen" }];
    await db.attempts.update("a", { answers: saved });
    // Typed on, with a second picture pasted, just before the tab closed: the draft is written but the save is not.
    const typed = [{ label: "a", doc: doc({ type: "text", text: "Seen, typed on" }, image(picture(1)), image(picture(2))), text: "Seen, typed on" }];
    writeAnswerDraft("s", "a", typed);
    expect(localStorage.getItem("saq-answer-draft:a")!.length).toBeLessThan(600);
    await recoverAnswerDrafts("s");
    const recovered = (await db.attempts.get("a"))!.answers[0];
    expect(recovered.text).toBe("Seen, typed on");
    expect(recovered.doc).toEqual(doc({ type: "text", text: "Seen, typed on" }, image(picture(1))));
    // A save that has caught up clears the draft, pictures and all.
    writeAnswerDraft("s", "a", typed);
    clearAnswerDraft("a", saved);
    expect(Object.keys(localStorage)).toHaveLength(1);
    clearAnswerDraft("a", typed);
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
