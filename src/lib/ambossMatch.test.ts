import { describe, expect, it } from "vitest";
import { markTerms } from "./ambossMatch";

describe("markTerms", () => {
  it("marks case-insensitively at word boundaries", () => {
    const segs = markTerms("Severe Chest pain, not chestpain.", [{ term: "chest pain", pgId: "p1" }]);
    expect(segs.filter((s) => s.pgId).map((s) => s.text)).toEqual(["Chest pain"]);
  });
  it("prefers the longest term and never nests", () => {
    const segs = markTerms("acute coronary syndrome", [
      { term: "coronary", pgId: "short" },
      { term: "acute coronary syndrome", pgId: "long" },
    ]);
    expect(segs).toEqual([{ text: "acute coronary syndrome", term: "acute coronary syndrome", pgId: "long" }]);
  });
  it("matches a hyphen where the term has a space", () => {
    const segs = markTerms("radio-radial delay", [{ term: "radio radial delay", pgId: "p" }]);
    expect(segs[0].pgId).toBe("p");
  });
  it("keeps surrounding text intact", () => {
    const segs = markTerms("A man with fever and rigors.", [{ term: "fever", pgId: "f" }, { term: "rigors", pgId: "r" }]);
    expect(segs.map((s) => s.text).join("")).toBe("A man with fever and rigors.");
    expect(segs.filter((s) => s.pgId)).toHaveLength(2);
  });
});
