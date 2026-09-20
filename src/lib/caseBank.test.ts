import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { caseSetName, isCaseBank, parseCaseBank, type CaseFile } from "./caseBank";

const F = new URL("./__fixtures__/casebank/", import.meta.url).pathname;
const read = (rel: string): CaseFile => ({ name: rel.split("/").pop()!, text: readFileSync(F + rel, "utf8") });

describe("case bank", () => {
  const files = [
    read("questions/case_02_questions.txt"),
    read("questions/case_03_questions.txt"),
    read("explained_answers/case_02_explained_answers.txt"),
    read("explained_answers/case_03_explained_answers.txt"),
    read("contents_and_coverage.txt"),
  ];

  it("splits one file holding every case's questions and answers into sets", () => {
    const one = { name: "everything.txt", text: files.slice(0, 4).map((f) => f.text).join("\n\n") };
    const bank = parseCaseBank([one, read("contents_and_coverage.txt")]);
    expect(bank.cases.map((c) => c.number)).toEqual([2, 3]);
    for (const c of bank.cases) {
      expect(c.hasAnswers).toBe(true);
      expect(c.questions.length).toBeGreaterThan(0);
      expect(c.questions.every((q) => q.modelAnswer || q.parts.some((p) => p.modelAnswer))).toBe(true);
    }
    // Each case's answers straight after its questions works too.
    const interleaved = { name: "everything.txt", text: [files[0], files[2], files[1], files[3]].map((f) => f.text).join("\n\n") };
    expect(parseCaseBank([interleaved]).cases.map((c) => [c.number, c.hasAnswers])).toEqual([[2, true], [3, true]]);
  });

  it("detects the format", () => {
    expect(isCaseBank(files)).toBe(true);
    expect(isCaseBank([{ name: "x.txt", text: "1. What is this?" }])).toBe(false);
  });

  it("parses cases with stems, questions, parts, marks and time", () => {
    const bank = parseCaseBank(files);
    expect(bank.collection).toBe("Dizziness SAQ Bank");
    expect(bank.cases.map((c) => c.number)).toEqual([2, 3]);
    const c2 = bank.cases[0];
    expect(c2.title).toBe("Dizziness after a recent respiratory illness");
    expect(c2.marks).toBe(25);
    expect(c2.minutes).toBe(31);
    expect(c2.instructions).toMatch(/^- Answer the numbered questions/);
    expect(c2.stem).toMatch(/^Daniel Reed/);
    expect(c2.questions).toHaveLength(4);
    expect(c2.questions.map((q) => q.marks)).toEqual([9, 5, 6, 5]);
    expect(c2.questions[0].stems).toEqual([c2.stem]);
    expect(c2.questions[0].text).toMatch(/^List THREE \(3\) plausible diagnoses/);
    expect(c2.questions[0].text).toContain("Mark allocation");
    expect(c2.questions[1].text).toMatch(/^Symptoms have been continuous/);
    expect(c2.questions[1].parts.map((p) => [p.label, p.marks])).toEqual([["a", 2], ["b", 2], ["c", 1]]);
    expect(caseSetName(c2)).toBe("Case 02");
  });

  it("attaches model answers per question and per part, and case-level notes", () => {
    const c2 = parseCaseBank(files).cases[0];
    expect(c2.hasAnswers).toBe(true);
    expect(c2.questions[0].modelAnswer).toContain("Vestibular neuritis");
    expect(c2.questions[0].modelAnswer).toContain("Posterior circulation ischaemic stroke");
    const a = c2.questions[1].parts[0].modelAnswer ?? "";
    expect(a).toContain("Left vestibular neuritis");
    expect(a).not.toMatch(/^State the most likely diagnosis/);
    expect(c2.questions[3].parts[2].modelAnswer).toContain("HINTS-type interpretation");
    expect(c2.markingNotes).toContain("Apply the explicit part caps");
    expect(c2.debrief).toMatch(/^COMMON REASONING ERRORS/);
    expect(c2.debrief).toContain("CLINICAL REFERENCES");
  });

  it("reads conditions from the coverage file", () => {
    const bank = parseCaseBank(files);
    expect(bank.cases[0].conditions).toEqual(["Vestibular neuritis", "Labyrinthitis", "Posterior circulation stroke", "Drug-induced vestibular symptoms"]);
    expect(bank.cases[1].conditions).toContain("Cerebellar haemorrhage");
  });

  it("keeps one copy of a case that appears in both the combined and the per-case files", () => {
    const combined = { name: "all_questions.txt", text: "DIZZINESS SAQ BANK — CASES 02–16\n\n" + files[0].text + "\n==========\n" + files[1].text };
    const bank = parseCaseBank([combined, ...files]);
    expect(bank.cases.map((c) => c.number)).toEqual([2, 3]);
    expect(bank.cases[0].questions[1].parts[0].modelAnswer).toContain("Left vestibular neuritis");
  });

  it("works from the combined files too", () => {
    const combined = [
      { name: "all_questions.txt", text: "DIZZINESS SAQ BANK — CASES 02–16\n\n==========\n\n" + files[0].text + "\n==========\n" + files[1].text },
      { name: "all_explained_answers.txt", text: "DIZZINESS SAQ BANK — EXPLAINED ANSWERS\n\n" + files[2].text + "\n==========\n" + files[3].text },
    ];
    const bank = parseCaseBank(combined);
    expect(bank.cases).toHaveLength(2);
    expect(bank.cases[1].questions[0].modelAnswer).toBeTruthy();
    expect(bank.cases[0].conditions).toEqual([]);
  });
});

describe("abdominal pain bank (SET headers, title-first coverage)", () => {
  const A = new URL("./__fixtures__/abdominal/", import.meta.url).pathname;
  const readA = (rel: string): CaseFile => ({ name: rel.split("/").pop()!, text: readFileSync(A + rel, "utf8") });
  const files = [readA("questions/abdominal_01_questions.txt"), readA("explained_answers/abdominal_01_explained_answers.txt"), readA("contents_and_coverage.txt")];

  it("parses the set", async () => {
    const { parseAnswersOnly, hasQuestionChunks } = await import("./caseBank");
    const bank = parseCaseBank(files);
    expect(bank.collection).toBe("Abdominal Pain SAQ Bank");
    expect(bank.cases).toHaveLength(1);
    const c = bank.cases[0];
    expect(c.number).toBe(1);
    expect(c.title).toBe("Pain that changes location");
    expect(c.marks).toBe(28);
    expect(c.minutes).toBe(35);
    expect(c.stem.length).toBeGreaterThan(50);
    expect(c.questions.map((q) => q.marks)).toEqual([9, 5, 8, 6]);
    expect(c.questions[1].parts.map((p) => p.label)).toEqual(["a", "b"]);
    expect(c.questions[1].parts[0].modelAnswer).toContain("FBC/CRP");
    expect(c.questions[0].modelAnswer).toContain("Acute appendicitis");
    expect(c.conditions).toContain("Appendicitis");
    expect(c.conditions).toContain("Testicular torsion");
    expect(hasQuestionChunks(files)).toBe(true);
    const answersOnly = parseAnswersOnly([files[1]]);
    expect(answersOnly).toHaveLength(1);
    expect(answersOnly[0].byQuestion.get(3)).toContain("Laparoscopic appendicectomy");
    expect(hasQuestionChunks([files[1]])).toBe(false);
  });
});
