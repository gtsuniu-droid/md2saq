import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import type { Question } from "../data/types";
import { applyBankUpdate, exportSet, importSetPack, type SetPack } from "./exportImport";
import { getPublicLink, loadSharedPack, publicOrigin, sharedPath } from "./publicLinks";
import { setLinkCode } from "./shortSetLink";
import { publishedQuestion } from "./questionIdentity";

const question = (id: string, order: number): Question => ({ id, setId: "set", order, text: `Question ${id}`, parts: [], presentations: [], tags: [], createdAt: 1 });
const pack = (): SetPack => ({ format: "saq-practice-set", version: 1, set: { id: "set", name: "Shared case", createdAt: 1 }, questions: [question("q1", 0), question("q2", 1)] });
beforeEach(async () => {
  vi.unstubAllGlobals();
  await db.questions.clear(); await db.sets.clear();
});

describe("public sharing", () => {
  it("contains only bank and question IDs, safely encoded", () => {
    expect(sharedPath("bank/a", "q ?")).toBe("/shared/bank%2Fa/question/q%20%3F");
    expect(publicOrigin("http://localhost:5173")).toBe("https://saqmd2.netlify.app");
    expect(publicOrigin("https://saqmd2.netlify.app/paper")).toBe("https://saqmd2.netlify.app");
  });
  it("loads one public bank set without reading or altering private data", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(pack())));
    vi.stubGlobal("fetch", fetch);
    expect(await loadSharedPack("bank/a")).toEqual(pack());
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/bank?id=bank%2Fa");
    expect(await db.sets.count()).toBe(0);
  });
  it("refuses unpublished sets without publishing anything", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(pack()))));
    vi.stubGlobal("fetch", fetch);
    await expect(getPublicLink(pack().set)).rejects.toThrow("Publish this set");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("creates only a short set link that survives local ID changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(pack()))));
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:5173" } });
    const code = await setLinkCode("bank");
    expect(code).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(await getPublicLink({ ...pack().set, id: "local-copy", bankId: "bank" })).toEqual({ path: `/s/${code}`, url: `https://saqmd2.netlify.app/s/${code}` });
  });
  it("never guesses a legacy match from position or ambiguous content", () => {
    expect(publishedQuestion(pack(), question("new", 0))).toBeUndefined();
    const legacy = { ...question("q1", 0), id: "local" };
    expect(publishedQuestion(pack(), legacy)?.id).toBe("q1");
    expect(publishedQuestion({ ...pack(), questions: [question("q1", 0), { ...question("q1", 1), id: "duplicate" }] }, legacy)).toBeUndefined();
    expect(publishedQuestion(pack(), { ...legacy, bankQuestionId: "deleted" })).toBeUndefined();
  });
  it("rejects missing or malformed published content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("Not found", { status: 404 })).mockResolvedValueOnce(new Response("{}")));
    await expect(loadSharedPack("gone")).rejects.toThrow("Not found");
    await expect(loadSharedPack("broken")).rejects.toThrow("could not be read");
  });
  it("keeps canonical IDs on import collisions, reorder, edits and re-export", async () => {
    await db.sets.add(pack().set);
    await db.questions.bulkAdd(pack().questions);
    const imported = await importSetPack(pack(), "bank");
    expect(imported).not.toBe("set");
    const before = await db.questions.where("setId").equals(imported).sortBy("order");
    expect(before[0].id).not.toBe("q1");
    expect(before[0].bankQuestionId).toBe("q1");
    const updated = { ...pack(), questions: [{ ...question("q2", 0), text: "Edited second question" }, question("q1", 1)] };
    await applyBankUpdate(imported, updated, 2);
    const after = await db.questions.where("setId").equals(imported).sortBy("order");
    expect(after.map(q => q.id)).toEqual([before[1].id, before[0].id]);
    expect((await exportSet(imported)).questions.map(q => q.id)).toEqual(["q2", "q1"]);
  });
});
