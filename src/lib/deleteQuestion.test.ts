import { describe, expect, it } from "vitest";
import { sessionWithout } from "./deleteQuestion";

const s = { questionIds: ["a", "b", "c"], attemptIds: ["1", "2", "3"], index: 2 };

describe("sessionWithout", () => {
  it("drops the question and its attempt, keeping the position sensible", () => {
    expect(sessionWithout(s, "b")).toEqual({ questionIds: ["a", "c"], attemptIds: ["1", "3"], index: 1 });
    expect(sessionWithout({ ...s, index: 0 }, "b")).toEqual({ questionIds: ["a", "c"], attemptIds: ["1", "3"], index: 0 });
    expect(sessionWithout(s, "c")?.index).toBe(1);
  });
  it("leaves a session alone when the question is not in it, and ends an emptied one", () => {
    expect(sessionWithout(s, "zzz")).toBe(s);
    expect(sessionWithout({ questionIds: ["a"], attemptIds: ["1"], index: 0 }, "a")).toBeNull();
    expect(sessionWithout(null, "a")).toBeNull();
  });
});
