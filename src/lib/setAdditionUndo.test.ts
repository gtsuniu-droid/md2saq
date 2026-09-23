import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import { DEFAULT_SETTINGS, type Question, type QuestionSet } from "../data/types";
import { saveAddedSet, undoSetAddition, restoreSetAddition } from "./setAdditionUndo";
import { deleteBankSet, listBank } from "./bank";
vi.mock("./admin", () => ({ isAdmin: () => true }));
vi.mock("./bank", () => ({ deleteBankSet: vi.fn(async () => {}), listBank: vi.fn(async () => []) }));
const set = (id: string): QuestionSet => ({ id, name: id, createdAt: 1 });
const q = (id: string): Question => ({ id: `q-${id}`, setId: id, order: 0, text: "Question", parts: [], presentations: ["cough"], tags: [], createdAt: 1 });
const add = (id: string, batch = "batch") => saveAddedSet(set(id), [q(id)], { id: batch, label: "Imported files" });
beforeEach(async () => {
  await Promise.all([db.sets.clear(), db.questions.clear(), db.attempts.clear(), db.setAdditions.clear(), db.settings.clear()]);
  vi.mocked(deleteBankSet).mockReset().mockResolvedValue(undefined);
  vi.mocked(listBank).mockReset().mockResolvedValue([]);
  await db.settings.put({ ...DEFAULT_SETTINGS, bankPasscode: "test" });
});
describe("undo set additions", () => {
  it("undoes a ten-set batch together, preserves unrelated data and restores every question", async () => {
    for (let i = 0; i < 10; i++) await add(String(i));
    await add("keep", "other");
    await undoSetAddition("batch");
    expect((await db.sets.toArray()).map((s) => s.id)).toEqual(["keep"]);
    expect((await db.setAdditions.get("batch"))?.undoneIds).toHaveLength(10);
    await restoreSetAddition("batch");
    expect(await db.sets.count()).toBe(11);
    expect(await db.questions.count()).toBe(11);
    expect((await db.sets.get("0"))?.dirty).toBe(true);
  });
  it("blocks the entire undo if any set was edited or used", async () => {
    await add("a"); await add("b");
    await db.questions.update("q-b", { text: "Edited" });
    await expect(undoSetAddition("batch")).rejects.toThrow("edited");
    expect(await db.sets.count()).toBe(2);
    await db.questions.put(q("b"));
    await db.attempts.put({ id: "attempt", questionId: "q-b", mode: "practice", startedAt: 2, elapsedSec: 1, answers: [] });
    await expect(undoSetAddition("batch")).rejects.toThrow("study session");
    expect(await db.sets.count()).toBe(2);
  });
  it("keeps a failed cloud deletion locally and resumes after a partially completed undo", async () => {
    await add("a"); await add("b");
    await db.sets.update("a", { bankId: "cloud-a", bankUpdatedAt: 1 });
    await db.sets.update("b", { bankId: "cloud-b", bankUpdatedAt: 1 });
    vi.mocked(deleteBankSet).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Network offline"));
    await expect(undoSetAddition("batch")).rejects.toThrow("offline");
    expect(await db.sets.get("a")).toBeUndefined();
    expect(await db.sets.get("b")).toBeDefined();
    await undoSetAddition("batch");
    expect(deleteBankSet).toHaveBeenCalledTimes(3);
    expect(await db.sets.count()).toBe(0);
  });
  it("protects another account's batch and newer shared versions", async () => {
    await add("a");
    await db.setAdditions.update("batch", { ownerId: "someone-else" });
    await expect(undoSetAddition("batch")).rejects.toThrow("another account");
    await db.setAdditions.update("batch", { ownerId: "" });
    await db.sets.update("a", { bankId: "cloud-a", bankUpdatedAt: 1 });
    vi.mocked(listBank).mockResolvedValue([{ id: "cloud-a", updatedAt: 3, uploadedAt: 1 } as Awaited<ReturnType<typeof listBank>>[number]]);
    await expect(undoSetAddition("batch")).rejects.toThrow("another device");
    expect(deleteBankSet).not.toHaveBeenCalled();
  });
  it("rolls back creation with an inactive journal and restoration with an ID collision", async () => {
    await add("a"); await add("b"); await undoSetAddition("batch");
    await expect(add("c")).rejects.toThrow("no longer active");
    expect(await db.sets.get("c")).toBeUndefined();
    expect(await db.questions.get("q-c")).toBeUndefined();
    await db.sets.put(set("b"));
    await expect(restoreSetAddition("batch")).rejects.toThrow("already exists");
    expect(await db.sets.get("a")).toBeUndefined();
  });
});

it("moving a set also updates its explicit primary presentation", async () => {
  const { moveSetToPresentation } = await import("./movePresentation");
  await add("a");
  await db.sets.update("a", { primaryPresentation: "cough" });
  await moveSetToPresentation("a", "vomiting");
  expect((await db.sets.get("a"))?.primaryPresentation).toBe("vomiting");
  expect((await db.questions.get("q-a"))?.presentations[0]).toBe("vomiting");
});
