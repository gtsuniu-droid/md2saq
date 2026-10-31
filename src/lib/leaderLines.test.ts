import { expect, it } from "vitest";
import { LEADER_LINES, leaderLine } from "./leaderLines";

it("crowns a leader with a line only once the lead is worth it, and laughs at the runners-up only when there are two", () => {
  expect(leaderLine("Ball clapper", 4, 0.5)).toBeNull();
  expect(leaderLine("Ball clapper", 5, 0)).toBe("Ball clapper is cooking 🍳");
  const picks = Array.from({ length: LEADER_LINES.length }, (_, i) => i / LEADER_LINES.length);
  // With nobody in third place, every line names the leader and none points at the others.
  const alone = new Set(picks.map((p) => leaderLine("Eiden", 7, p, undefined, ["Ana"])!));
  expect(alone.size).toBe(LEADER_LINES.length - 1);
  for (const l of alone) { expect(l).toContain("Eiden"); expect(l).not.toMatch(/\{|\}|🫵|\.$/); }
  // With a podium, the last line names second and third place instead.
  const podium = new Set(picks.map((p) => leaderLine("Eiden", 7, p, undefined, ["Ana", "Bo"])!));
  expect(podium.size).toBe(LEADER_LINES.length);
  expect(podium.has("Ana and Bo, 🤣😂🫵")).toBe(true);
  expect(LEADER_LINES.map((l) => l.text)).toEqual(["{name} is cooking", "{name} is mogging you all", "{name} is eating and leaving no crumbs", "{name} is on demon time", "{name} is locked in", "{second} and {third}, 🤣😂🫵"]);
});

it("ranked by sets, the leader gets a line for a lead of two sets, whatever their question count", () => {
  expect(leaderLine("Eiden", 4, 0, true)).toBe("Eiden is cooking 🍳");
  expect(leaderLine("Eiden", 40, 0, false)).toBeNull();
});
