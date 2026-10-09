import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { db, patchSettings } from "../data/db";
import { DEFAULT_SETTINGS } from "../data/types";
import { deleteSetEverywhere } from "./share";
import { deleteBankSet, ensureSetContent } from "./bank";
import { recordDeletes } from "./sync";

vi.mock("./bank", () => ({
  BankPasscodeError: class extends Error {},
  ensureSetContent: vi.fn(async () => {}), deleteBankSet: vi.fn(async () => {}),
  updateBankSet: vi.fn(), uploadBankSet: vi.fn(),
}));
vi.mock("./sync", () => ({ recordDeletes: vi.fn(async () => {}) }));
vi.mock("./exportImport", () => ({ exportSet: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(deleteBankSet).mockResolvedValue(undefined);
  await Promise.all([db.settings.clear(), db.sets.clear(), db.questions.clear(), db.attempts.clear(), db.marks.clear()]);
  await db.settings.put({ ...DEFAULT_SETTINGS, cloudUser: { uid: "admin", email: "gtsuniu@gmail.com" }, bankPasscode: "test" });
  for (const id of ["remove", "keep"]) {
    await db.sets.put({ id, name: id, createdAt: 1, bankId: `bank-${id}` });
    await db.questions.put({ id: `q-${id}`, setId: id, order: 0, text: "Question", parts: [], presentations: [], tags: [], createdAt: 1 });
    await db.attempts.put({ id: `a-${id}`, questionId: `q-${id}`, mode: "practice", startedAt: 2, elapsedSec: 1, answers: [] });
  }
});

it("blocks non-admin deletion before loading or changing data", async () => {
  await patchSettings({ cloudUser: { uid: "learner", email: "learner@example.com" } });
  await expect(deleteSetEverywhere("remove")).rejects.toThrow("Only admins");
  expect(ensureSetContent).not.toHaveBeenCalled();
  expect(deleteBankSet).not.toHaveBeenCalled();
  expect(await db.sets.count()).toBe(2);
});

it("does not silently remove a shared set locally when Admin is locked", async () => {
  await patchSettings({ bankPasscode: undefined });
  await expect(deleteSetEverywhere("remove")).rejects.toThrow("Unlock Admin");
  expect(deleteBankSet).not.toHaveBeenCalled();
  expect(await db.questions.count()).toBe(2);
  expect(await db.sets.count()).toBe(2);
});

it("keeps the entire set and its attempts if cloud deletion fails", async () => {
  vi.mocked(deleteBankSet).mockRejectedValueOnce(new Error("Network offline"));
  await expect(deleteSetEverywhere("remove")).rejects.toThrow("offline");
  expect(await db.sets.count()).toBe(2);
  expect(await db.questions.count()).toBe(2);
  expect(await db.attempts.count()).toBe(2);
  expect(recordDeletes).not.toHaveBeenCalled();
});

it("deletes the selected shared set and records attempt deletion without touching another set", async () => {
  expect(await deleteSetEverywhere("remove")).toEqual({ local: true, published: true });
  expect(deleteBankSet).toHaveBeenCalledExactlyOnceWith("bank-remove", "test");
  expect((await db.sets.toArray()).map(s => s.id)).toEqual(["keep"]);
  expect((await db.questions.toArray()).map(q => q.id)).toEqual(["q-keep"]);
  expect((await db.attempts.toArray()).map(a => a.id)).toEqual(["a-keep"]);
  expect(recordDeletes).toHaveBeenCalledWith("attempts", ["a-remove"]);
});

it("lets an admin remove an unpublished set without a cloud request", async () => {
  await patchSettings({ bankPasscode: undefined });
  await db.sets.update("remove", { bankId: undefined });
  expect(await deleteSetEverywhere("remove")).toEqual({ local: true, published: false });
  expect(deleteBankSet).not.toHaveBeenCalled();
});
