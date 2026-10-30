import { expect, it } from "vitest";
import { isBlankAttempt } from "./blankAttempt";

it("calls an attempt blank only when every part has nothing in it", () => {
  const part = (text: string, doc: unknown = null) => ({ label: "a", text, doc });
  expect(isBlankAttempt({ answers: [part(""), part("   ")] })).toBe(true);
  expect(isBlankAttempt({ answers: [part(""), part("Aspirin")] })).toBe(false);
  // A picture is an answer; no parts at all is not a blank attempt, just an odd one.
  expect(isBlankAttempt({ answers: [part("", { type: "doc", content: [{ type: "image" }] })] })).toBe(false);
  expect(isBlankAttempt({ answers: [] })).toBe(false);
});
