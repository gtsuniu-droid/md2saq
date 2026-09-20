import { describe, expect, it } from "vitest";
import { parseCaseBank } from "../lib/caseBank";
import { FORMAT_GUIDE, FORMAT_SAMPLE_ANSWERS, FORMAT_SAMPLE_COVERAGE, FORMAT_SAMPLE_QUESTIONS } from "./formatGuide";

describe("format guide", () => {
  it("describes a format the parser accepts", () => {
    const bank = parseCaseBank([
      { name: "questions.txt", text: FORMAT_SAMPLE_QUESTIONS },
      { name: "answers.txt", text: FORMAT_SAMPLE_ANSWERS },
      { name: "contents_and_coverage.txt", text: FORMAT_SAMPLE_COVERAGE },
    ]);
    expect(bank.cases).toHaveLength(1);
    const c = bank.cases[0];
    expect(c.title).toBe("Dizziness after a cold");
    expect(c.marks).toBe(7);
    expect(c.minutes).toBe(10);
    expect(c.stem).toMatch(/^A 42-year-old man/);
    expect(c.questions.map((q) => q.marks)).toEqual([3, 4]);
    expect(c.questions[0].modelAnswer).toContain("Vestibular neuritis");
    expect(c.questions[1].parts.map((p) => [p.label, p.marks])).toEqual([["a", 1], ["b", 3]]);
    expect(c.questions[1].parts[1].modelAnswer).toContain("Direction-fixed nystagmus");
    expect(c.conditions).toEqual(["Vestibular neuritis", "Labyrinthitis", "Posterior circulation stroke"]);
    expect(c.markingNotes).toContain("Accept clinically equivalent");
    expect(c.debrief).toContain("COMMON REASONING ERRORS");
  });

  it("is short enough to sit in a prompt", () => {
    expect(FORMAT_GUIDE.length).toBeLessThan(3500);
  });
});
