import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, unknown>();
vi.mock("@netlify/blobs", () => ({
  getStore: () => ({
    get: async (key: string) => memory.get(key) ?? null,
    setJSON: async (key: string, value: unknown) => { memory.set(key, value); },
    delete: async (key: string) => { memory.delete(key); },
  }),
}));

import handler from "../../netlify/functions/bank";

const post = (body: unknown, passcode = "secret") =>
  handler(new Request("http://x/api/bank", { method: "POST", headers: { "content-type": "application/json", "x-passcode": passcode }, body: JSON.stringify(body) }));
const get = (query = "", passcode = "secret") =>
  handler(new Request(`http://x/api/bank${query}`, { headers: { "x-passcode": passcode } }));

describe("bank function", () => {
  beforeEach(() => { memory.clear(); process.env.BANK_PASSCODE = "secret"; });

  it("rejects a wrong passcode for uploads and for browsing", async () => {
    const res = await post({ format: "saq-practice-text", name: "x", text: "1. Q?" }, "nope");
    expect(res.status).toBe(403);
    expect((await get("", "nope")).status).toBe(403);
    expect((await handler(new Request("http://x/api/bank"))).status).toBe(403);
  });

  it("parses plain text into a set and lists it", async () => {
    const res = await post({
      format: "saq-practice-text",
      name: "Chest pain batch",
      key: "batch-1",
      text: "1. A man with chest pain. List three causes. (3 marks)\nAnswer:\nACS\nPE\nDissection\n2. A woman with haematuria. Outline investigations.",
    });
    expect(res.status).toBe(201);
    const entry = (await res.json()) as { id: string; questionCount: number; presentations: string[] };
    expect(entry.questionCount).toBe(2);
    expect(entry.presentations).toContain("chest-pain");
    expect(entry.presentations).toContain("haematuria");

    const list = await (await get()).json() as { sets: { id: string }[] };
    expect(list.sets).toHaveLength(1);

    const pack = await (await get(`?id=${entry.id}`)).json() as { questions: { marks?: number; modelAnswer?: string }[] };
    expect(pack.questions[0].marks).toBe(3);
    expect(pack.questions[0].modelAnswer).toBe("ACS\nPE\nDissection");
  });

  it("does not duplicate a set sent twice with the same key", async () => {
    await post({ format: "saq-practice-text", name: "a", key: "k", text: "1. What is this?" });
    const again = await post({ format: "saq-practice-text", name: "a", key: "k", text: "1. What is this?" });
    expect(again.status).toBe(200);
    expect((await again.json() as { duplicate?: boolean }).duplicate).toBe(true);
    const list = await (await get()).json() as { sets: unknown[] };
    expect(list.sets).toHaveLength(1);
  });

  it("refuses text with no parsable questions", async () => {
    const res = await post({ format: "saq-practice-text", name: "a", text: "   " });
    expect(res.status).toBe(400);
  });
});

describe("bank editing", () => {
  beforeEach(() => { memory.clear(); process.env.BANK_PASSCODE = "secret"; });

  it("updates a set in place and deletes it", async () => {
    const created = await (await post({ format: "saq-practice-text", name: "v1", text: "1. First?" })).json() as { id: string; uploadedAt: number };
    const pack = await (await get(`?id=${created.id}`)).json() as { set: { name: string; tags?: string[] }; questions: unknown[] };
    pack.set.name = "v2";
    pack.set.tags = ["Vestibular neuritis"];
    const put = await handler(new Request(`http://x/api/bank?id=${created.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-passcode": "secret" }, body: JSON.stringify(pack) }));
    expect(put.status).toBe(200);
    const entry = await put.json() as { name: string; tags?: string[]; uploadedAt: number; updatedAt?: number };
    expect(entry.name).toBe("v2");
    expect(entry.tags).toEqual(["Vestibular neuritis"]);
    expect(entry.uploadedAt).toBe(created.uploadedAt);
    expect(entry.updatedAt).toBeGreaterThanOrEqual(created.uploadedAt);
    const list = await (await get()).json() as { sets: { name: string }[] };
    expect(list.sets.map((s) => s.name)).toEqual(["v2"]);

    const del = await handler(new Request(`http://x/api/bank?id=${created.id}`, { method: "DELETE", headers: { "x-passcode": "secret" } }));
    expect(del.status).toBe(200);
    expect((await (await get()).json() as { sets: unknown[] }).sets).toHaveLength(0);
    expect((await get(`?id=${created.id}`)).status).toBe(404);
  });
});
