import { describe, expect, it } from "vitest";
import type { QuestionSet, SubPart } from "../data/types";
import { applyAnswers, type ParsedAnswers } from "./caseBank";
import { matchAnswers } from "./mergeAnswers";

const set = (id: string, source?: string): QuestionSet => ({ id, name: id, source, createdAt: 1 });
const answers = (number: number, title: string): ParsedAnswers => ({ number, title, byQuestion: new Map() });

describe("merging answers", () => {
  it("matches by case number, then by title", () => {
    const sets = [set("a", "Case 01: Pain that changes location"), set("b", "Case 02: Pain beneath the right ribs"), set("c", "Persistent upper abdominal pain")];
    const m = matchAnswers([answers(2, "Pain beneath the right ribs"), answers(3, "Persistent upper abdominal pain"), answers(9, "Nothing like this")], sets);
    expect(m.map((x) => [x.setId, x.reason])).toEqual([["b", "case number"], ["c", "title"], [null, "none"]]);
  });

  it("applies answers to stored questions by question number and part", () => {
    const qs = [
      { text: "List three causes.", parts: [], modelAnswer: undefined as string | undefined },
      { text: "Intro.", parts: [{ label: "a", text: "Name one test." }, { label: "b", text: "Justify it." }] as SubPart[], modelAnswer: undefined as string | undefined },
    ];
    const n = applyAnswers(qs, new Map([[1, "1. Appendicitis\n2. Ureteric colic"], [2, "a) Name one test. [1 marks]\n- [1 marks] CRP\nb) Justify it. [1 marks]\n- [1 marks] Inflammation"]]));
    expect(n).toBe(2);
    expect(qs[0].modelAnswer).toBe("1. Appendicitis\n2. Ureteric colic");
    expect(qs[1].parts[0].modelAnswer).toBe("- [1 marks] CRP");
    expect(qs[1].parts[1].modelAnswer).toBe("- [1 marks] Inflammation");
  });
});
