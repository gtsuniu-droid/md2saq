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
  beforeEach(() => { memory.clear(); process.env.BANK_PASSCODE = "secret"; process.env.NETLIFY = "true"; });

  it("lets anyone read but only the passcode write", async () => {
    const res = await post({ format: "saq-practice-text", name: "x", text: "1. Q?" }, "nope");
    expect(res.status).toBe(403);
    expect((await get("", "nope")).status).toBe(200);
    expect((await handler(new Request("http://x/api/bank"))).status).toBe(200);
    expect((await get("?verify=1", "nope")).status).toBe(403);
    expect((await get("?verify=1")).status).toBe(204);
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
  beforeEach(() => { memory.clear(); process.env.BANK_PASSCODE = "secret"; process.env.NETLIFY = "true"; });

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

describe("numbering", () => {
  beforeEach(() => { memory.clear(); process.env.BANK_PASSCODE = "secret"; process.env.NETLIFY = "true"; });
  const pack = (id: string, presentations: string[], tags?: string[]) => ({
    format: "saq-practice-set", version: 1, set: { id, name: id, createdAt: 1, tags },
    questions: [{ id: `${id}-q`, setId: id, order: 0, text: "Q?", parts: [], presentations, tags: [], createdAt: 1 }],
  });

  it("counts from 1 within each presentation", async () => {
    const d1 = await (await post(pack("d1", ["dizziness"]))).json() as { number: number; group: string };
    const d2 = await (await post(pack("d2", ["dizziness"]))).json() as { number: number };
    const a1 = await (await post(pack("a1", ["abdominal-pain"]))).json() as { number: number; group: string };
    const t1 = await (await post(pack("t1", ["chest-pain"], ["Dizziness::Vestibular"]))).json() as { number: number; group: string };
    expect([d1.number, d2.number, a1.number, t1.number]).toEqual([1, 2, 1, 3]);
    expect(d1.group).toBe("dizziness");
    expect(a1.group).toBe("abdominal-pain");
    expect(t1.group).toBe("dizziness");
  });

  it("gives a set a new number when it moves to another presentation, and keeps it otherwise", async () => {
    const d1 = await (await post(pack("d1", ["dizziness"]))).json() as { id: string; number: number };
    const kept = await (await post(pack("d1", ["dizziness"], ["Vestibular neuritis"]))).json() as { number: number };
    expect(kept.number).toBe(d1.number);
    const put = await handler(new Request(`http://x/api/bank?id=${d1.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-passcode": "secret" }, body: JSON.stringify(pack("d1", ["chest-pain"])) }));
    const moved = await put.json() as { number: number; group: string };
    expect(moved.group).toBe("chest-pain");
    expect(moved.number).toBe(1);
  });

  it("renumbers an index made under the old running scheme, once", async () => {
    memory.set("index", [
      { id: "x1", number: 1, name: "a", questionCount: 1, presentations: ["dizziness"], uploadedAt: 1 },
      { id: "x2", number: 2, name: "b", questionCount: 1, presentations: ["abdominal-pain"], uploadedAt: 2 },
      { id: "x3", number: 3, name: "c", questionCount: 1, presentations: ["dizziness"], uploadedAt: 3 },
      { id: "x4", name: "d", questionCount: 1, presentations: ["abdominal-pain"], uploadedAt: 4 },
    ]);
    const list = await (await get()).json() as { sets: { id: string; number: number; group: string }[] };
    const byId = Object.fromEntries(list.sets.map((s) => [s.id, `${s.group}:${s.number}`]));
    expect(byId).toEqual({ x1: "dizziness:1", x3: "dizziness:2", x2: "abdominal-pain:1", x4: "abdominal-pain:2" });
    expect(memory.get("numbering")).toBe(2);
  });
});

describe("publishing the same set twice", () => {
  beforeEach(() => { memory.clear(); process.env.BANK_PASSCODE = "secret"; process.env.NETLIFY = "true"; });

  it("updates the existing entry instead of duplicating", async () => {
    const pack = { format: "saq-practice-set", version: 1, set: { id: "set-abc", name: "A", createdAt: 1 }, questions: [{ id: "q1", setId: "set-abc", order: 0, text: "Q?", parts: [], presentations: [], tags: [], createdAt: 1 }] };
    const first = await (await post(pack)).json() as { id: string; number?: number };
    const second = await (await post({ ...pack, set: { ...pack.set, name: "A renamed" } })).json() as { id: string; number?: number; name: string };
    expect(second.id).toBe(first.id);
    expect(second.number).toBe(first.number);
    expect(second.name).toBe("A renamed");
    const list = await (await get()).json() as { sets: unknown[] };
    expect(list.sets).toHaveLength(1);
  });
});
