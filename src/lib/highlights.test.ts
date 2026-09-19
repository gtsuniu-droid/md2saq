import { describe, expect, it } from "vitest";
import { splitByRanges, toggleRange } from "./highlights";

describe("toggleRange", () => {
  it("adds and merges", () => {
    expect(toggleRange([{ start: 0, end: 5 }], { start: 3, end: 8 })).toEqual([{ start: 0, end: 8 }]);
  });
  it("removes when the selection is already highlighted", () => {
    expect(toggleRange([{ start: 0, end: 10 }], { start: 3, end: 5 })).toEqual([{ start: 0, end: 3 }, { start: 5, end: 10 }]);
  });
});

describe("splitByRanges", () => {
  it("splits plain and term segments at highlight boundaries", () => {
    const segs = [{ text: "chest " }, { text: "pain", term: "pain", pgId: "p" }, { text: " today" }];
    const pieces = splitByRanges(segs, [{ start: 3, end: 8 }]);
    expect(pieces.map((p) => [p.text, !!p.hl, !!p.pgId])).toEqual([
      ["che", false, false],
      ["st ", true, false],
      ["pa", true, true],
      ["in", false, true],
      [" today", false, false],
    ]);
  });
});
