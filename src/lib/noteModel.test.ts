import { expect, it } from "vitest";
import { openingSection, sectionsFor } from "./noteModel";

it("shows Overview only where notes are still in it, and opens on a section with notes", () => {
  expect(sectionsFor([{ section: "ddx" }]).map((s) => s.id)).toEqual(["ddx", "hx-exam", "ix", "mx", "extras"]);
  // Older notes saved before sections existed count as Overview, so they are never hidden.
  expect(sectionsFor([{ section: "ix" }, { section: undefined }])[0].id).toBe("overview");
  expect(openingSection(null, [])).toBe("ddx");
  expect(openingSection(null, [{ section: "mx" }])).toBe("mx");
  expect(openingSection(null, [{ section: undefined }, { section: "mx" }])).toBe("overview");
  expect(openingSection("ix", [{ section: "mx" }])).toBe("ix");
  // An old link to Overview where nothing is left in it lands on the first section with notes.
  expect(openingSection("overview", [{ section: "mx" }])).toBe("mx");
});
