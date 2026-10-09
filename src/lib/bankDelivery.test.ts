import { describe, expect, it } from "vitest";
import { deliverCatalogue, deliverContent, deliverImage, saveDelivery } from "../../netlify/lib/bankDelivery";
import type { SetPack } from "./setPack";

const picture = "data:image/png;base64,aW1hZ2U=";
const pack: SetPack = { format: "saq-practice-set", version: 1,
  set: { id: "s", name: "Case", primaryPresentation: "cough", createdAt: 1 },
  questions: [{ id: "q", setId: "s", order: 0, text: "Prompt", stems: ["Case stem"], presentations: ["cough"], parts: [{ label: "a", text: "Part", modelAnswer: "secret" }], tags: [], createdAt: 1,
    modelAnswer: "Answer", modelAnswerDoc: { type: "doc", content: [{ type: "image", attrs: { src: picture } }] }, images: [{ id: "im", dataUrl: picture, place: "stem" }] }],
};
const entry = { id: "b", number: 1, uploadedAt: 1, updatedAt: 2 };
function storage() {
  const values = new Map<string, unknown>([["sets/b", pack]]);
  const reads: string[] = [];
  return { values, reads, get: async (key: string) => { reads.push(key); return values.get(key) ?? null; }, setJSON: async (key: string, data: unknown) => { values.set(key, data); } };
}

describe("cloud catalogue and content delivery", () => {
  it("backfills old published sets once and serves one cached catalogue with no images or answers", async () => {
    const store = storage();
    const req = new Request("https://site.test/api/bank?catalogue=1");
    const first = await deliverCatalogue(store, [entry], req);
    const text = await first.text();
    expect(text).toContain("Case stem");
    expect(text).not.toContain("secret"); expect(text).not.toContain("data:image"); expect(text).not.toContain("modelAnswer");
    store.reads.length = 0;
    expect(await (await deliverCatalogue(store, [entry], req)).text()).toBe(text);
    expect(store.reads).toHaveLength(1);
    const unchanged = await deliverCatalogue(store, [entry], new Request(req.url, { headers: { "if-none-match": first.headers.get("etag")! } }));
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
  });
  it("separates and deduplicates images, keeps rich formatting, and serves immutable media", async () => {
    const store = storage();
    await saveDelivery(store, entry, pack, "https://site.test");
    expect([...store.values.keys()].filter(k => k.startsWith("images/"))).toHaveLength(1);
    const response = await deliverContent(store, entry, "https://site.test");
    const content = await response.json() as SetPack;
    expect(content.questions[0].modelAnswer).toBe("Answer");
    const url = content.questions[0].images![0].dataUrl;
    expect(url).toMatch(/^https:\/\/site.test\/api\/bank\?image=[a-f0-9]{64}$/);
    expect(JSON.stringify(content.questions[0].modelAnswerDoc)).toContain(url);
    expect(response.headers.get("cache-control")).toContain("immutable");
    const image = await deliverImage(store, new URL(url).searchParams.get("image")!);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(await image.text()).toBe("image");
    expect((await deliverImage(store, "../index")).status).toBe(404);
    expect(pack.questions[0].images![0].dataUrl).toBe(picture);
  });
  it("changes the catalogue revision after publish, renumber and deletion", async () => {
    const store = storage(); const req = new Request("https://site.test/api/bank?catalogue=1");
    const old = await deliverCatalogue(store, [entry], req);
    const changed = { ...entry, updatedAt: 3 };
    await saveDelivery(store, changed, { ...pack, set: { ...pack.set, name: "Updated case" } }, "https://site.test");
    const next = await deliverCatalogue(store, [changed], req);
    expect(next.headers.get("etag")).not.toBe(old.headers.get("etag"));
    expect(await next.text()).toContain("Updated case");
    const numbered = await deliverCatalogue(store, [{ ...changed, number: 4 }], req);
    expect((await numbered.json()).entries[0].set.number).toBe(4);
    expect((await (await deliverCatalogue(store, [], req)).json()).entries).toHaveLength(0);
  });
});
