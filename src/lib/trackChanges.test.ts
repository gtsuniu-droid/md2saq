import { expect, it } from "vitest";
import { changesBetween } from "./trackChanges";

// One paragraph: offset i sits at editor position i + 1, and the document ends at length + 1.
const positions = (text: string) => [...Array.from(text, (_, i) => i + 1), text.length + 1];

it("maps added words to editor ranges and keeps removed words at the spot they were", () => {
  const now = "Aspirin 300 mg and PCI within 120 minutes";
  const { inserted, deleted } = changesBetween("Aspirin and PCI", now, positions(now));
  expect(inserted.map((r) => now.slice(r.from - 1, r.to - 1))).toEqual(["300 mg", "within 120 minutes"]);
  expect(deleted).toEqual([]);
  const shorter = "PCI";
  const gone = changesBetween("Aspirin and PCI", shorter, positions(shorter));
  expect(gone.deleted).toEqual([{ at: 1, text: "Aspirin and " }]);
  // Positions stay aligned after a replacement earlier in the line.
  const replaced = "McBurney point, with guarding, would favour appendicitis over the other two.";
  const c = changesBetween("McBurney point would support appendicitis.", replaced, positions(replaced));
  expect(c.inserted.map((r) => replaced.slice(r.from - 1, r.to - 1))).toEqual(["point, with guarding,", "favour appendicitis over the other two."]);
  expect(c.deleted.map((d) => [d.text, replaced.slice(d.at - 1, d.at + 4)])).toEqual([["point ", "point"], ["support appendicitis.", "favou"]]);
  expect(gone.inserted).toEqual([]);
});

it("shows nothing when the text is unchanged, and a deletion at the end when the end was cut", () => {
  const same = "Carpal tunnel syndrome";
  expect(changesBetween(same, same, positions(same))).toEqual({ inserted: [], deleted: [] });
  const cut = "Carpal tunnel";
  expect(changesBetween(same, cut, positions(cut)).deleted).toEqual([{ at: cut.length + 1, text: "syndrome" }]);
});
