import { expect, it } from "vitest";
import { setHeadline, setLabel, shortTitle } from "./sets";

it("keeps the number as the name and adds a short reminder of the case", () => {
  expect(setLabel({ number: 3, name: "Set 03" })).toBe("Set 03");
  expect(setHeadline({ number: 3, name: "Set 03" })).toBe("Set 03");
  expect(setHeadline({ number: 3, name: "Set 03", source: "Newly found hypertension in a 48-year-old" })).toBe("Set 03: Newly found hypertension in a 48-year-old");
  expect(setHeadline({ number: 12, name: "Case 12: Severe hypertension and headache at 30 weeks of pregnancy with visual symptoms" })).toBe("Set 12: Severe hypertension and headache at 30 weeks of…");
  expect(shortTitle("Short one")).toBe("Short one");
  expect(shortTitle("A very long title that goes on and on, for a long time", 24)).toBe("A very long title that…");
});
