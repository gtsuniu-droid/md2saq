import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db";
import { DEFAULT_SETTINGS, type Question } from "../data/types";
import { applyPersonalSetEdits, loadPersonalSetEdits, resetPersonalSetEdits, savePersonalSetEdits } from "./personalSetEdits";

const original: Question = { id: "q", setId: "s", order: 0, text: "Shared prompt", stems: ["Shared case"], modelAnswer: "Shared answer", parts: [], presentations: [], tags: [], createdAt: 1 };
beforeEach(async () => {
  await Promise.all([db.meta.clear(), db.questions.clear(), db.sets.clear(), db.settings.clear()]);
  await db.settings.put({ ...DEFAULT_SETTINGS, cloudUser: { uid: "reader", email: "reader@example.com" } });
  await db.sets.put({ id: "s", name: "Shared", createdAt: 1, dirty: false });
  await db.questions.put(original);
});

describe("personal Browse edits", () => {
  it("keeps edits separate from the shared bank and other accounts", async () => {
    await savePersonalSetEdits("reader", "s", [original], [{ ...original, text: "My prompt" }]);
    expect((await loadPersonalSetEdits("reader")).size).toBe(1);
    expect((await loadPersonalSetEdits("someone-else")).size).toBe(0);
    expect(await db.questions.get("q")).toEqual(original);
    expect((await db.sets.get("s"))?.dirty).toBe(false);
    const edits = (await loadPersonalSetEdits("reader")).get("s");
    // Later bank answers and new questions continue to arrive.
    const updated = { ...original, modelAnswer: "New shared answer" };
    expect(applyPersonalSetEdits([updated, { ...original, id: "new" }], edits)).toEqual([{ ...updated, text: "My prompt" }, { ...original, id: "new" }]);
  });
  it("resets personal edits without modifying shared content", async () => {
    await savePersonalSetEdits("reader", "s", [original], [{ ...original, modelAnswer: "My answer" }]);
    await resetPersonalSetEdits("reader", "s");
    expect((await loadPersonalSetEdits("reader")).size).toBe(0);
    expect(await db.questions.get("q")).toEqual(original);
  });
  it("preserves rich images and cleared optional fields", async () => {
    const image = { type: "doc", content: [{ type: "image", attrs: { src: "data:image/png;base64,fixture" } }] };
    await savePersonalSetEdits("reader", "s", [original], [{ ...original, textDoc: image, modelAnswer: undefined }]);
    expect(applyPersonalSetEdits([original], (await loadPersonalSetEdits("reader")).get("s"))[0]).toMatchObject({ textDoc: image, modelAnswer: undefined });
  });
  it("refuses a save after account switching", async () => {
    await expect(savePersonalSetEdits("previous-user", "s", [original], [{ ...original, text: "Wrong owner" }])).rejects.toThrow("account changed");
    expect(await db.meta.count()).toBe(0);
  });
});
