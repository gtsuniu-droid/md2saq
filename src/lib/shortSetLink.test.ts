import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLinkCode } from "./shortSetLink";
const { get, setJSON } = vi.hoisted(() => ({ get: vi.fn(), setJSON: vi.fn() }));
vi.mock("@netlify/blobs", () => ({ getStore: () => ({ get, setJSON }) }));
import bank from "../../netlify/functions/bank";
beforeEach(() => { vi.stubEnv("NETLIFY", "true"); get.mockReset(); setJSON.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe("short set links", () => {
  it("keeps a stable compact code without exposing the long bank ID", async () => {
    const id = "064a76f3-c22f-4b5d-87d3-cfdf01234567";
    expect(await setLinkCode(id)).toBe(await setLinkCode(id));
    expect(await setLinkCode(id)).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(await setLinkCode(id)).not.toBe(await setLinkCode("other"));
  });
  it("resolves a set in two read-only lookups without renumbering or creating mappings", async () => {
    const pack = { format: "saq-practice-set", set: { id: "original", name: "Renamed set" }, questions: [] };
    get.mockImplementation(async key => key === "index" ? [{ id: "other" }, { id: "bank", name: "Renamed set", number: 99 }] : key === "sets/bank" ? pack : null);
    const result = await bank(new Request(`https://example.com/api/bank?short=${await setLinkCode("bank")}`));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ bankId: "bank", pack });
    expect(get).toHaveBeenCalledTimes(2);
    expect(setJSON).not.toHaveBeenCalled();
  });
  it("handles deleted, invalid and ambiguous links without returning a wrong set", async () => {
    get.mockResolvedValue([]);
    expect((await bank(new Request("https://example.com/api/bank?short=bad"))).status).toBe(404);
    expect((await bank(new Request(`https://example.com/api/bank?short=${await setLinkCode("missing")}`))).status).toBe(404);
    get.mockResolvedValue([{ id: "same" }, { id: "same" }]);
    expect((await bank(new Request(`https://example.com/api/bank?short=${await setLinkCode("same")}`))).status).toBe(404);
  });
});
