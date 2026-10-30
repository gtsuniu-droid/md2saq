import { expect, it } from "vitest";
import { tickList, tickedScore } from "./markingTicks";

const tagged = `MARKING: Maximum 3 marks. For THREE different anatomical categories, award 0.5 for the category and 0.5 for an example.
- [1 mark] Brain/central cerebral disease: stroke/TIA, or multiple sclerosis.
- [1 mark] Spinal cord disease: cervical cord compression.
- [1 mark] Nerve-root disease: cervical radiculopathy.
- [0.5] Focal peripheral nerve disease: carpal tunnel syndrome.
ACCEPTABLE ALTERNATIVES: Brachial plexopathy from a plausible plexus injury.
DO NOT ACCEPT: Three named diseases without categorisation.
Evidence: [NICE NG127](https://www.nice.org.uk/guidance/ng127).`;

it("reads tagged lines as tick rows and keeps the rest as guidance", () => {
  const list = tickList(tagged)!;
  expect(list.rows.map((r) => [r.marks, r.text.slice(0, 12)])).toEqual([[1, "Brain/centra"], [1, "Spinal cord "], [1, "Nerve-root d"], [0.5, "Focal periph"]]);
  expect(list.guidance.map((g) => g.split(":")[0])).toEqual(["MARKING", "ACCEPTABLE ALTERNATIVES", "DO NOT ACCEPT", "Evidence"]);
  expect(tickedScore(list, [1, 2, 4], 3)).toBe(2.5);
  expect(tickedScore(list, [1, 2, 3, 4], 3)).toBe(3);
});

it("gives no list for a rubric or prose model answer, or one with a single tagged line", () => {
  expect(tickList("MARKING: Maximum 9 marks. TWO history findings [1 each] and ONE examination finding [1].\n- Carpal tunnel syndrome: history options include waking at night.")).toBeNull();
  expect(tickList("Aspirin 300 mg, then PCI within 120 minutes.")).toBeNull();
  expect(tickList("- [1 mark] Only one point here.")).toBeNull();
  expect(tickList(undefined)).toBeNull();
});
