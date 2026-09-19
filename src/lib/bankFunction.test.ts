import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, unknown>();
vi.mock("@netlify/blobs", () => ({
  getStore: () => ({
    get: async (key: string) => memory.get(key) ?? null,
    setJSON: async (key: string, value: unknown) => { memory.set(key, value); },
  }),
}));

import handler from "../../netlify/functions/bank";

const post = (body: unknown, passcode = "secret") =>
  handler(new Request("http://x/api/bank", { method: "POST", headers: { "content-type": "application/json", "x-passcode": passcode }, body: JSON.stringify(body) }));

describe("bank function", () => {
  beforeEach(() => { memory.clear(); process.env.BANK_PASSCODE = "secret"; });

  it("rejects a wrong passcode", async () => {
    const res = await post({ format: "saq-practice-text", name: "x", text: "1. Q?" }, "nope");
    expect(res.status).toBe(403);
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

    const list = await (await handler(new Request("http://x/api/bank"))).json() as { sets: { id: string }[] };
    expect(list.sets).toHaveLength(1);

    const pack = await (await handler(new Request(`http://x/api/bank?id=${entry.id}`))).json() as { questions: { marks?: number; modelAnswer?: string }[] };
    expect(pack.questions[0].marks).toBe(3);
    expect(pack.questions[0].modelAnswer).toBe("ACS\nPE\nDissection");
  });

  it("does not duplicate a set sent twice with the same key", async () => {
    await post({ format: "saq-practice-text", name: "a", key: "k", text: "1. What is this?" });
    const again = await post({ format: "saq-practice-text", name: "a", key: "k", text: "1. What is this?" });
    expect(again.status).toBe(200);
    expect((await again.json() as { duplicate?: boolean }).duplicate).toBe(true);
    const list = await (await handler(new Request("http://x/api/bank"))).json() as { sets: unknown[] };
    expect(list.sets).toHaveLength(1);
  });

  it("refuses text with no parsable questions", async () => {
    const res = await post({ format: "saq-practice-text", name: "a", text: "   " });
    expect(res.status).toBe(400);
  });
});
