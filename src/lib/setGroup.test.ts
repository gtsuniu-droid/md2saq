import { describe, expect, it } from "vitest";
import { dominantPresentation, nextNumberIn, numberingGroup, rankedPresentations, setNumberLabel } from "./setGroup";

const qs = (...ps: string[][]) => ps.map((presentations) => ({ presentations }));

describe("set numbering groups", () => {
  it("picks the dominant presentation, first seen on a tie", () => {
    expect(dominantPresentation(qs(["dizziness"], ["chest-pain"], ["chest-pain"]))).toBe("chest-pain");
    expect(dominantPresentation(qs(["dizziness"], ["chest-pain"]))).toBe("dizziness");
    expect(dominantPresentation(qs([]))).toBeUndefined();
    expect(rankedPresentations(qs(["dizziness"], ["chest-pain"], ["chest-pain"]))).toEqual(["chest-pain", "dizziness"]);
  });

  it("groups by the top of the first :: tag, matched to a presentation when it is one", () => {
    expect(numberingGroup(["Vertigo", "Dizziness::Vestibular::Set_01"], qs(["chest-pain"]))).toBe("dizziness");
    expect(numberingGroup(["Abdominal_pain::Appendicitis"], [])).toBe("abdominal-pain");
    expect(numberingGroup(["MD2 :: Neuro"], qs(["dizziness"]))).toBe("md2");
    expect(numberingGroup(["Appendicitis"], qs(["abdominal-pain"]))).toBe("abdominal-pain");
    expect(numberingGroup(undefined, [])).toBe("untagged");
  });

  it("numbers from 1 within each group", () => {
    const taken = [{ group: "dizziness", number: 3 }, { group: "dizziness", number: 1 }, { group: "chest-pain", number: 2 }];
    expect(nextNumberIn("dizziness", taken)).toBe(4);
    expect(nextNumberIn("chest-pain", taken)).toBe(3);
    expect(nextNumberIn("abdominal-pain", taken)).toBe(1);
  });

  it("shows two digits", () => {
    expect(setNumberLabel(1)).toBe("Set 01");
    expect(setNumberLabel(12)).toBe("Set 12");
    expect(setNumberLabel(123)).toBe("Set 123");
  });
});
