import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import { syncFromBank, ensureSetContent } from "./bank";
import { catalogueEntry, CATALOGUE_KEY } from "./bankCatalogue";
import { loadLibrary } from "./library";
import type { SetPack } from "./setPack";

const pack = (id: number): SetPack => ({ format: "saq-practice-set", version: 1,
  set: { id: `set-${id}`, name: `Set ${id}`, primaryPresentation: "cough", createdAt: 1 },
  questions: [{ id: `q-${id}`, setId: `set-${id}`, order: 0, text: "Published question", modelAnswer: "Full answer", parts: [], presentations: ["cough"], tags: [], createdAt: 1 }],
});
const json = (body: unknown) => new Response(JSON.stringify(body));
function network(count: number, read: (id: number) => Promise<Response> = async id => json(pack(id))) {
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/bank?catalogue=1") return json({ version: 1, entries: Array.from({ length: count }, (_, i) => catalogueEntry(`bank-${i}`, 2, pack(i), i + 1)) });
    return read(Number(new URL(url, "https://test.local").searchParams.get("content")!.split("-")[1]));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(async () => { await db.sets.clear(); await db.questions.clear(); await db.meta.delete(CATALOGUE_KEY); });
afterEach(() => vi.unstubAllGlobals());

describe("catalogue-first library", () => {
  it("makes all 95 sets available in one request without importing any full content", async () => {
    const fetcher = network(95);
    const first = syncFromBank();
    expect(syncFromBank()).toBe(first);
    expect(await first).toBe(95);
    const library = await loadLibrary();
    expect(library.sets).toHaveLength(95);
    expect(library.questions).toHaveLength(95);
    expect(library.questions.every(q => !q.modelAnswer)).toBe(true);
    expect(library.pending.size).toBe(95);
    expect(await db.questions.count()).toBe(0);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/bank?catalogue=1");
    expect(await syncFromBank()).toBe(0);
  });
  it("fetches only the opened set and reuses cached content and overlapping requests", async () => {
    const fetcher = network(95);
    await syncFromBank();
    const one = ensureSetContent("set-5");
    expect(ensureSetContent("set-5")).toBe(one);
    await one;
    expect(await db.sets.count()).toBe(1);
    expect(await db.questions.count()).toBe(1);
    expect((await db.questions.get("q-5"))?.modelAnswer).toBe("Full answer");
    await ensureSetContent("set-5");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await loadLibrary()).sets).toHaveLength(95);
  });
  it("protects unpublished edits, including edits made during a download", async () => {
    await db.sets.add({ ...pack(0).set, bankId: "bank-0", bankUpdatedAt: 1 });
    network(1, async () => {
      await db.sets.update("set-0", { name: "Unpublished edit", dirty: true });
      return json(pack(0));
    });
    await syncFromBank(); await ensureSetContent("set-0");
    expect(await db.sets.get("set-0")).toMatchObject({ name: "Unpublished edit", dirty: true, bankUpdatedAt: 1 });
    const fetcher = network(1);
    await ensureSetContent("set-0");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains question identity for history and for sessions planned before hydration", async () => {
    await db.sets.add({ ...pack(0).set, bankId: "bank-0", bankUpdatedAt: 1 });
    await db.questions.add({ ...pack(0).questions[0], id: "local-question", bankQuestionId: "q-0", text: "Old" });
    network(1);
    await syncFromBank();
    expect((await loadLibrary()).questions[0].id).toBe("local-question");
    await ensureSetContent("set-0");
    expect((await db.questions.get("local-question"))?.text).toBe("Published question");
    expect(await db.questions.count()).toBe(1);
  });
  it("keeps new question IDs stable when refreshing an existing set", async () => {
    await db.sets.add({ ...pack(0).set, bankId: "bank-0", bankUpdatedAt: 1 });
    network(1);
    await syncFromBank();
    const before = (await loadLibrary()).questions[0].id;
    await ensureSetContent("set-0");
    expect((await db.questions.toArray())[0].id).toBe(before);
  });
  it("handles question ID collisions without changing the planned session IDs", async () => {
    await db.sets.add({ ...pack(9).set });
    await db.questions.add({ ...pack(0).questions[0], setId: "set-9" });
    network(1); await syncFromBank();
    const before = (await loadLibrary()).questions.find(q => q.setId === "set-0")!.id;
    expect(before).not.toBe("q-0");
    await ensureSetContent("set-0");
    expect((await db.questions.get(before))?.setId).toBe("set-0");
    expect((await db.questions.get("q-0"))?.setId).toBe("set-9");
  });
  it("keeps the catalogue on a failed download, retries, and leaves cached content usable offline", async () => {
    network(1, async () => new Response("Offline", { status: 503 }));
    await syncFromBank();
    await expect(ensureSetContent("set-0")).rejects.toThrow("Offline");
    expect((await loadLibrary()).sets).toHaveLength(1);
    network(1); await ensureSetContent("set-0");
    const fetcher = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
    await expect(ensureSetContent("set-0")).resolves.toBe("set-0");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not duplicate another tab's completed import", async () => {
    network(1, async () => {
      await db.sets.add({ ...pack(0).set, bankId: "bank-0", bankUpdatedAt: 2 });
      await db.questions.bulkAdd(pack(0).questions);
      return json(pack(0));
    });
    await syncFromBank(); await ensureSetContent("set-0");
    expect(await db.sets.count()).toBe(1);
  });
});

it("builds cloud session references for sets that have not been downloaded", async () => {
  const { questionRef, adoptSession } = await import("./sync");
  network(3); await syncFromBank();
  const library = await loadLibrary();
  const q = library.questions[2];
  const ref = await questionRef(q);
  expect(ref.bankId).toBe("bank-2");
  const byBank = new Map(library.questions.map(question => [ `${library.sets.find(s => s.id === question.setId)!.bankId}#${question.order}`, question ]));
  const recovered = adoptSession({ id: "session", _m: 1, session: { id: "session-id", mode: "practice", questionIds: ["another-device-id"], attemptIds: ["saved-attempt"], index: 0, startedAt: 1 }, qrefs: [ref] }, new Map(library.questions.map(question => [question.id, question])), byBank);
  expect(recovered?.questionIds).toEqual([q.id]);
  expect(recovered?.attemptIds).toEqual(["saved-attempt"]);
  expect(await db.questions.count()).toBe(0);
});

it("preserves old remapped IDs when media is delivered as separate URLs", async () => {
  const { withIdentityKeys } = await import("./bankCatalogue");
  const original = pack(0);
  original.questions[0].images = [{ id: "im", place: "stem", dataUrl: "data:image/png;base64,aW1hZ2U=" }];
  await db.sets.add({ ...original.set, bankId: "bank-0", bankUpdatedAt: 1 });
  await db.questions.add({ ...original.questions[0], id: "legacy-random-id" });
  const entry = await withIdentityKeys(catalogueEntry("bank-0", 2, original), original.questions);
  await db.meta.put({ id: CATALOGUE_KEY, value: JSON.stringify({ version: 1, entries: [entry] }) });
  expect((await loadLibrary()).questions[0].id).toBe("legacy-random-id");
  const delivered = structuredClone(original);
  delivered.questions[0].images![0].dataUrl = "https://site.test/api/bank?image=hash";
  vi.stubGlobal("fetch", vi.fn(async () => json(delivered)));
  await ensureSetContent("set-0");
  expect(await db.questions.count()).toBe(1);
  expect(await db.questions.get("legacy-random-id")).toMatchObject({ bankQuestionId: "q-0", images: [{ dataUrl: "https://site.test/api/bank?image=hash" }] });
});
