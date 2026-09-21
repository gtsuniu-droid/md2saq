import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import { getSharedNotesIndex, refreshSharedNotesIndex } from "./sharedNotes";
import { handleNotes } from "../../netlify/functions/notes";

beforeEach(async () => { await db.meta.delete("sharedNotes.index"); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("shared notes availability", () => {
  it("discovers every saved presentation with a key listing and no note downloads", async () => {
    const store = {
      list: vi.fn(async () => ({ blobs: [
        { key: "chest-pain/shared-one" }, { key: "chest-pain/shared-two" },
        { key: "altered-bowel-habit/shared-three" }, { key: "unknown/shared-four" },
        { key: "chest-pain/other" }, { key: "chest-pain/shared-one/invalid" },
      ] })),
      getWithMetadata: vi.fn(async () => null),
      setJSON: vi.fn(async () => ({ modified: false })),
    };
    const r = await handleNotes(new Request("https://test/api/notes?index=1"), store, undefined);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ presentations: ["altered-bowel-habit", "chest-pain"] });
    expect(store.list).toHaveBeenCalledOnce();
    expect(store.getWithMetadata).not.toHaveBeenCalled();
    expect(store.setJSON).not.toHaveBeenCalled();
  });
  it("caches the cloud inventory on a fresh device without loading note content", async () => {
    const fetcher = vi.fn(async () => Response.json({ presentations: ["chest-pain", "altered-bowel-habit"] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await getSharedNotesIndex()).toEqual([]);
    await Promise.all([refreshSharedNotesIndex(), refreshSharedNotesIndex()]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/notes?index=1", { cache: "no-store" });
    expect(await getSharedNotesIndex()).toEqual(["chest-pain", "altered-bowel-habit"]);
  });
  it("retains the saved index on failure and rejects invalid server data", async () => {
    await db.meta.put({ id: "sharedNotes.index", value: '["chest-pain"]' });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ presentations: ["unknown"] })));
    await expect(refreshSharedNotesIndex()).rejects.toThrow("index");
    expect(await getSharedNotesIndex()).toEqual(["chest-pain"]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Offline"); }));
    await expect(refreshSharedNotesIndex()).rejects.toThrow("Offline");
    expect(await getSharedNotesIndex()).toEqual(["chest-pain"]);
  });
});
