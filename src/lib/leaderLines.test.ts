import { expect, it } from "vitest";
import { LEADER_LINES, leaderLine } from "./leaderLines";

it("crowns a leader with a line only once the lead is worth it, saving the count lines for big weeks", () => {
  expect(leaderLine("Ball clapper", 4, 0.5)).toBeNull();
  expect(leaderLine("Ball clapper", 5, 0)).toBe("Ball clapper is cooking.");
  // Every line fits the name in, and the count lines only appear from 20.
  for (let i = 0; i < LEADER_LINES.length; i++) {
    const small = leaderLine("Eiden", 7, i / LEADER_LINES.length)!;
    expect(small).toContain("Eiden");
    expect(small).not.toMatch(/\{|\}|\b7 questions\b/);
  }
  const big = new Set(Array.from({ length: LEADER_LINES.length }, (_, i) => leaderLine("Eiden", 42, i / LEADER_LINES.length)));
  expect([...big].some((l) => l?.includes("42 questions"))).toBe(true);
  expect(big.size).toBe(LEADER_LINES.length);
});
