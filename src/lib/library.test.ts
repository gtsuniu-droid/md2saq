import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db } from "../data/db";
import { CATALOGUE_KEY } from "./bankCatalogue";
import { hideRemovedCopies, libraryBreakdown, loadLibrary } from "./library";

const set = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Set ${id}`, presentations: [], createdAt: 1, ...extra });
const entry = (bankId: string, setId: string) => ({ id: bankId, revision: 5, set: { ...set(setId), number: 1 }, questions: [], identityKeys: [] });

beforeEach(async () => {
  await Promise.all([db.sets.clear(), db.questions.clear(), db.meta.clear()]);
  await db.meta.put({ id: CATALOGUE_KEY, value: JSON.stringify({ version: 1, entries: [entry("bank-a", "a"), entry("bank-b", "b")] }) });
  await db.sets.bulkAdd([
    set("a", { bankId: "bank-a", bankUpdatedAt: 5 }),
    set("b", { bankId: "bank-b", bankUpdatedAt: 5, dirty: true }),
    set("gone-edited", { bankId: "bank-gone", bankUpdatedAt: 2, dirty: true }),
    set("gone-plain", { bankId: "bank-gone-2", bankUpdatedAt: 2 }),
    set("mine"),
  ] as never[]);
});

it("explains the device's set count: published, unpublished, and edited copies of removed sets", async () => {
  expect((await loadLibrary()).sets.map((s) => s.id).sort()).toEqual(["a", "b", "gone-edited", "mine"]);
  expect(await libraryBreakdown()).toEqual({ published: 2, unpublished: 1, removed: 1, removedIds: ["gone-edited"] });
});

it("hides removed copies from the library without deleting them", async () => {
  expect(await hideRemovedCopies()).toBe(1);
  expect((await loadLibrary()).sets.map((s) => s.id).sort()).toEqual(["a", "b", "mine"]);
  expect((await db.sets.get("gone-edited"))?.dirty).toBe(false);
  expect(await libraryBreakdown()).toMatchObject({ removed: 0 });
});
