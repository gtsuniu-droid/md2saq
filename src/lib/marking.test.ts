import { describe, expect, it } from "vitest";
import { hitTerms, markingPoints } from "./marking";

describe("markingPoints", () => {
  it("splits lines and strips list markers", () => {
    expect(markingPoints("- ECG\n2. Troponin\n(c) Chest X-ray")).toEqual(["ECG", "Troponin", "Chest X-ray"]);
  });
  it("splits a single line into sentences", () => {
    expect(markingPoints("Give oxygen. Obtain IV access. Call for help.")).toEqual([
      "Give oxygen.",
      "Obtain IV access.",
      "Call for help.",
    ]);
  });
  it("splits a semicolon list regardless of case", () => {
    expect(markingPoints("ECG for ischaemia; troponin for injury; FBE for anaemia")).toEqual([
      "ECG for ischaemia",
      "troponin for injury",
      "FBE for anaemia",
    ]);
  });
});

describe("hitTerms", () => {
  it("finds significant words present in the answer", () => {
    const hits = hitTerms("I would order a troponin and an ECG.", ["Troponin", "Chest X-ray"]);
    expect(hits).toContain("troponin");
    expect(hits).not.toContain("chest");
  });
});
