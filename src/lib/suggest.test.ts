import { describe, expect, it } from "vitest";
import { suggestPresentations } from "./suggest";

describe("suggestPresentations", () => {
  it("weights repeated mentions", () => {
    const text = "A man with chest pain. The chest pain radiates. He takes enalapril for hypertension.";
    expect(suggestPresentations(text)[0]).toBe("chest-pain");
  });
  it("returns nothing for unrelated text", () => {
    expect(suggestPresentations("Describe the mechanism of action of metformin.")).toEqual([]);
  });
});
