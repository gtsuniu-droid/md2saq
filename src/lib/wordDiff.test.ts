import { expect, it } from "vitest";
import { wordDiff } from "./wordDiff";

const show = (a: string, b: string) => wordDiff(a, b).map((p) => (p.kind === "same" ? p.text : p.kind === "del" ? `[-${p.text}-]` : `[+${p.text}+]`)).join("");

it("strikes what was replaced and adds what earns the mark, leaving kept words plain", () => {
  expect(show("O/e positive tinel sign", "O/e tapping over the median nerve reproduces the tingling")).toBe("O/e [-positive tinel sign-][+tapping over the median nerve reproduces the tingling+]");
  expect(show("Risk factors e.g pregnancy", "Wakes at night with tingling")).toBe("[-Risk factors e.g pregnancy-][+Wakes at night with tingling+]");
  expect(show("vision loss unilateral painless", "vision loss unilateral painless")).toBe("vision loss unilateral painless");
  expect(show("", "Added line")).toBe("[+Added line+]");
  expect(show("Gone", "")).toBe("[-Gone-]");
  // A short word matching by chance between two changes does not split them.
  expect(show("mesenteric adenitis and Meckel", "luminal obstruction and remnant")).toBe("[-mesenteric adenitis and Meckel-][+luminal obstruction and remnant+]");
  expect(show("pain in the RIF", "tenderness in the RIF")).toBe("[-pain-] [+tenderness+] in the RIF");
});

it("keeps line breaks and ignores case when matching words", () => {
  const parts = wordDiff("Carpal tunnel\n- typing", "carpal tunnel\n- wakes at night");
  expect(parts.filter((p) => p.kind === "same").map((p) => p.text).join("")).toBe("carpal tunnel\n- ");
  expect(parts.find((p) => p.kind === "del")?.text).toBe("typing");
  expect(parts.find((p) => p.kind === "ins")?.text).toBe("wakes at night");
});
