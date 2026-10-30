import { expect, it } from "vitest";
import { diffWithOrigin, wordDiff } from "./wordDiff";

const show = (a: string, b: string) => wordDiff(a, b).map((p) => (p.kind === "same" ? p.text : p.kind === "del" ? `[-${p.text}-]` : `[+${p.text}+]`)).join("");

it("strikes what was replaced and adds what earns the mark, leaving kept words plain", () => {
  expect(show("O/e positive tinel sign", "O/e tapping over the median nerve reproduces the tingling")).toBe("O/e [-positive tinel sign-][+tapping over the median nerve reproduces the tingling+]");
  expect(show("Risk factors e.g pregnancy", "Wakes at night with tingling")).toBe("[-Risk factors e.g pregnancy-][+Wakes at night with tingling+]");
  expect(show("vision loss unilateral painless", "vision loss unilateral painless")).toBe("vision loss unilateral painless");
  expect(show("", "Added line")).toBe("[+Added line+]");
  expect(show("Gone", "")).toBe("[-Gone-]");
  // A short word matching by chance between two changes does not split them.
  expect(show("mesenteric adenitis and Meckel", "luminal obstruction and remnant")).toBe("[-mesenteric adenitis and Meckel-][+luminal obstruction and remnant+]");
  expect(show("pain in the RIF", "tenderness in the RIF")).toBe("[-pain -][+tenderness+] in the RIF");
});

it("rebuilds the current text from everything but the deletions", () => {
  const before = "McBurney point would support appendicitis."; const after = "McBurney point, with guarding, would favour appendicitis over the other two.";
  expect(wordDiff(before, after).filter((p) => p.kind !== "del").map((p) => p.text).join("")).toBe(after);
  expect(wordDiff(before, "").filter((p) => p.kind !== "del").map((p) => p.text).join("")).toBe("");
});

it("keeps line breaks and ignores case when matching words", () => {
  const parts = wordDiff("Carpal tunnel\n- typing", "carpal tunnel\n- wakes at night");
  expect(parts.filter((p) => p.kind === "same").map((p) => p.text).join("")).toBe("carpal tunnel\n- ");
  expect(parts.find((p) => p.kind === "del")?.text).toBe("typing");
  expect(parts.find((p) => p.kind === "ins")?.text).toBe("wakes at night");
});

it("tells where kept and removed text sat in the original", () => {
  const before = "Aspirin and PCI"; const parts = diffWithOrigin(before, "Aspirin 300 mg then PCI");
  for (const p of parts) if (p.at !== undefined) expect(before.slice(p.at, p.at + p.text.length)).toBe(p.text);
  expect(parts.filter((p) => p.at !== undefined).map((p) => p.text).join("")).toBe("Aspirin and PCI");
  expect(parts.filter((p) => p.kind === "ins").every((p) => p.at === undefined)).toBe(true);
});
