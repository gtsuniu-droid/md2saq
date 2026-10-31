import { expect, it } from "vitest";
import { LEADER_LINES, leaderLine } from "./leaderLines";

it("crowns a leader with a line only once the lead is worth it, and laughs at the runners-up only when there are two", () => {
  expect(leaderLine("Ball clapper", 4, 0.5)).toBeNull();
  expect(leaderLine("Ball clapper", 5, 0)).toBe("Ball clapper is cooking 🍳");
  const picks = Array.from({ length: LEADER_LINES.length }, (_, i) => i / LEADER_LINES.length);
  // With nobody in third place, no line points at the others, and the lines that name the leader fit the name in.
  const alone = new Set(picks.map((p) => leaderLine("Eiden", 7, p, undefined, ["Ana"])!));
  expect(alone.size).toBe(LEADER_LINES.length - 1);
  for (const l of alone) expect(l).not.toMatch(/\{|\}|🫵|\.$/);
  expect(alone.has("Eiden mogs both Talley and O'Connor 🗿")).toBe(true);
  expect(alone.has("gg too EZ")).toBe(true);
  // With a podium, the last line names second and third place instead.
  const podium = new Set(picks.map((p) => leaderLine("Eiden", 7, p, undefined, ["Ana", "Bo"])!));
  expect(podium.size).toBe(LEADER_LINES.length);
  expect(podium.has("Ana and Bo, 🤣😂🫵")).toBe(true);
  expect(LEADER_LINES.map((l) => l.text)).toEqual(["{name} is cooking", "{name} mogs both Talley and O'Connor", "{name} is eating and leaving no crumbs", "{name} is on demon time", "{name} is locked in", "gg too EZ", "too easy mate", "{second} and {third}, 🤣😂🫵"]);
});

it("ranked by sets, the leader gets a line for a lead of two sets, whatever their question count", () => {
  expect(leaderLine("Eiden", 4, 0, true)).toBe("Eiden is cooking 🍳");
  expect(leaderLine("Eiden", 40, 0, false)).toBeNull();
});
