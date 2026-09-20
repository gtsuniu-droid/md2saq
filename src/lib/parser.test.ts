import { describe, expect, it } from "vitest";
import { extractMarks, parseQuestions } from "./parser";

describe("extractMarks", () => {
  it("reads bracketed marks", () => {
    expect(extractMarks("List three causes. (3 marks)")).toEqual({ text: "List three causes.", marks: 3 });
    expect(extractMarks("List three causes. [6]")).toEqual({ text: "List three causes.", marks: 6 });
    expect(extractMarks("List three causes. 2 marks")).toEqual({ text: "List three causes.", marks: 2 });
    expect(extractMarks("List three causes. (4)")).toEqual({ text: "List three causes.", marks: 4 });
  });
  it("leaves text without marks alone", () => {
    expect(extractMarks("Take 2 tablets (paracetamol) daily")).toEqual({ text: "Take 2 tablets (paracetamol) daily" });
  });
});

describe("parseQuestions", () => {
  it("splits numbered questions with dot", () => {
    const qs = parseQuestions(`1. What is the most likely diagnosis? (2 marks)
2. List two investigations. (2 marks)
3. Outline initial management.`);
    expect(qs).toHaveLength(3);
    expect(qs[0].number).toBe(1);
    expect(qs[0].text).toBe("What is the most likely diagnosis?");
    expect(qs[0].marks).toBe(2);
    expect(qs[2].marks).toBeUndefined();
  });

  it("handles Q1 / Question 1: forms and multi-line stems", () => {
    const qs = parseQuestions(`Question 1:
A 54 year old man presents with chest pain.
What is your differential? (4 marks)

Q2. A woman has haematuria.
Outline investigations.`);
    expect(qs).toHaveLength(2);
    expect(qs[0].text).toContain("54 year old");
    expect(qs[0].text).toContain("differential?");
    expect(qs[0].marks).toBe(4);
    expect(qs[1].text).toContain("haematuria");
  });

  it("captures model answers and does not split on numbered lists inside them", () => {
    const qs = parseQuestions(`1. List three causes of jaundice. (3 marks)
Answer:
1. Hepatitis
2. Gallstones
3. Haemolysis
2. What is the first investigation?
Model answer: LFTs`);
    expect(qs).toHaveLength(2);
    expect(qs[0].modelAnswer).toBe("1. Hepatitis\n2. Gallstones\n3. Haemolysis");
    expect(qs[1].modelAnswer).toBe("LFTs");
  });

  it("falls back to blank-line splitting and attaches answer blocks", () => {
    const qs = parseQuestions(`A 30 year old presents with fever. What are the red flags?

Answer: Neck stiffness, rash, photophobia

A patient has dyspnoea. Outline your assessment.`);
    expect(qs).toHaveLength(2);
    expect(qs[0].modelAnswer).toBe("Neck stiffness, rash, photophobia");
    expect(qs[1].text).toContain("dyspnoea");
  });

  it("extracts sub-parts with their marks and sums them", () => {
    const qs = parseQuestions(`1. A 70 year old woman falls at home.
(a) List three risk factors. (3 marks)
(b) What examination would you perform? (2 marks)
2. Next question.`);
    expect(qs[0].parts).toHaveLength(2);
    expect(qs[0].parts[0]).toEqual({ label: "a", text: "List three risk factors.", marks: 3 });
    expect(qs[0].parts[1].marks).toBe(2);
    expect(qs[0].marks).toBe(5);
  });

  it("handles a single question with an answer", () => {
    const qs = parseQuestions(`What is the treatment for anaphylaxis?
A: IM adrenaline 0.5 mg`);
    expect(qs).toHaveLength(1);
    expect(qs[0].modelAnswer).toBe("IM adrenaline 0.5 mg");
  });

  it("returns nothing for blank input", () => {
    expect(parseQuestions("  \n\n ")).toEqual([]);
  });

  it("strips bullet characters", () => {
    const qs = parseQuestions(`• 1. First question
• 2. Second question`);
    expect(qs).toHaveLength(2);
    expect(qs[1].text).toBe("Second question");
  });
});

describe("exam-style stems with numbered sub-parts", () => {
  const sample = `Question 32
Thiago Pecos is a 44-year-old man who is brought into the Emergency Department by ambulance with chest pain.
On general inspection, Thiago is alert and oriented.
1) List THREE (3) diagnoses which could account for Thiago's chest pain. (9 marks)
2) Thiago's chest pain subsides after receiving initial treatment.
List FIVE (5) additional initial investigations. (5 marks)
Answer:
1) ACS, aortic dissection, pericarditis
2) ECG, troponin, CXR, FBE, UEC

Question 33
A woman presents with dyspnoea.
1) Outline your assessment. (4 marks)`;

  it("keeps numeric sub-parts inside the question", () => {
    const qs = parseQuestions(sample);
    expect(qs).toHaveLength(2);
    expect(qs[0].number).toBe(32);
    expect(qs[0].text).toContain("Thiago Pecos");
    expect(qs[0].parts.map((p) => p.label)).toEqual(["1", "2"]);
    expect(qs[0].parts[0].marks).toBe(9);
    expect(qs[0].parts[1].text).toContain("List FIVE");
    expect(qs[0].parts[1].marks).toBe(5);
    expect(qs[0].marks).toBe(14);
  });

  it("distributes sectioned model answers to parts", () => {
    const qs = parseQuestions(sample);
    expect(qs[0].parts[0].modelAnswer).toBe("ACS, aortic dissection, pericarditis");
    expect(qs[0].parts[1].modelAnswer).toBe("ECG, troponin, CXR, FBE, UEC");
    expect(qs[1].parts[0].modelAnswer).toBeUndefined();
  });
});

describe("staged papers with stems", () => {
  const S = "/private/tmp/claude-502/-Users-gabe-Desktop-Frontal/384f50d6-d1cb-4be0-8ed0-69046cf8a54c/scratchpad";
  it("parses the dizziness paper", async () => {
    const { readFileSync } = await import("node:fs");
    const { parsePaper } = await import("./parser");
    const { questions: qs, meta } = parsePaper(readFileSync(`${S}/dizzy.txt`, "utf8"));
    expect(qs).toHaveLength(6);
    expect(meta.title).toBe("“I feel dizzy”");
    expect(meta.minutes).toBe(25);
    expect(meta.totalMarks).toBe(20);
    expect(qs.map((q) => q.marks)).toEqual([3, 4, 4, 4, 3, 2]);
    expect(qs[0].stems).toHaveLength(1);
    expect(qs[0].stems[0]).toMatch(/^Michael Tan/);
    expect(qs[0].text).toMatch(/^Generate an initial differential\./);
    expect(qs[0].text).toContain("List THREE plausible diagnoses");
    expect(qs[0].text).toContain("½ mark per diagnosis");
    expect(qs[1].stems).toHaveLength(1);
    expect(qs[2].stems).toHaveLength(2);
    expect(qs[2].stems[1]).toMatch(/^Further history reveals/);
    expect(qs[2].stems[1]).toContain("Marked unsteadiness");
    expect(qs[2].parts.map((p) => [p.label, p.marks])).toEqual([["a", 1], ["b", 2], ["c", 1]]);
    expect(qs[5].stems).toHaveLength(3);
    expect(qs[5].stems[2]).toMatch(/^A non-contrast CT brain/);
    expect(qs[5].text).not.toMatch(/Total/);
    expect(qs[5].parts).toHaveLength(2);
  });
  it("keeps unstaged papers as before", () => {
    const qs = parseQuestions("1. First question? (2 marks)\n2. Second question?");
    expect(qs).toHaveLength(2);
    expect(qs[0].stems).toEqual([]);
  });
});

describe("markdown from generators", () => {
  it("ignores headings, bold and rules, and reads Marks: n", () => {
    const qs = parseQuestions(`## **Question 1** (3 marks)
A man with chest pain. List three causes.

---

### Question 2
Marks: 2
**Part (a)** Name one investigation. [1 mark]
**Part (b)** Justify it. [1 mark]

**Answer key:**
a) ECG
b) Ischaemia`);
    expect(qs).toHaveLength(2);
    expect(qs[0].marks).toBe(3);
    expect(qs[0].text).toMatch(/^A man with chest pain/);
    expect(qs[1].marks).toBe(2);
    expect(qs[1].parts.map((p) => p.label)).toEqual(["a", "b"]);
    expect(qs[1].parts[0].modelAnswer).toBe("ECG");
  });
});
