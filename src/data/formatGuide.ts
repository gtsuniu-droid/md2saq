/**
 * The paste/drop format, written for an AI question generator. Kept short and
 * literal because it is copied into prompts. Every rule here is one the parser
 * in src/lib/parser.ts and src/lib/caseBank.ts actually applies.
 */
export const FORMAT_GUIDE = `SAQ FORMAT GUIDE (plain text, one file per case or several cases per file)

CASE 01: TITLE IN CAPITALS
MD2 short-answer questions | Total: 25 marks | Suggested time: 30 minutes

INSTRUCTIONS
- One line per instruction.

CLINICAL STEM

The case vignette. Plain sentences. Any length.

QUESTION 1 (9 marks)

Question text. "Suggested response format:" and "Mark allocation:" lines may follow.

QUESTION 2 (5 marks)

Optional new information for this question, then lettered parts:

a) First part. [2 marks]

b) Second part. [2 marks]

c) Third part. [1 marks]

TOTAL: 25 MARKS

ANSWERS go in a second file (or after a line of ===== in the same file):

CASE 01: TITLE IN CAPITALS
EXPLAINED MODEL ANSWERS AND MARKING GUIDE | Total: 25 marks

MARKING PRINCIPLES
- Optional notes shown to the marker.

QUESTION 1 (9 marks)

1. Condition name
   Mechanism: ...
   History 1: ...
2. Second condition
   ...

QUESTION 2 (5 marks)

a) First part. [2 marks]
- [1 marks] One marking point per line, starting with "- [n marks]".
- [1 marks] Another point.

b) Second part. [2 marks]
- [2 marks] A point worth two.

COMMON REASONING ERRORS
- Optional, shown after marking.

CLINICAL REFERENCES
- Optional.

COVERAGE (optional third file, gives the tags):

01 — 25 marks — Title in sentence case
  Condition one; Condition two; Condition three

RULES
- Case headers: "CASE 01:" with a two-digit number; questions: "QUESTION 1 (n marks)"; parts: "a)" to "h)" with "[n marks]".
- Marks in the question header win over the parts; part marks are summed when the header has none.
- Questions must be numbered 1, 2, 3 in order within a case. Do not number answer bullets 1. 2. 3. unless they are separate conditions.
- One marking point per line in answers. Keep each point self-contained; the marker ticks points individually.
- The same case number links questions, answers and coverage. Titles in the coverage file replace the capitals header.
- Diagnosis-style questions ("List THREE diagnoses...") feed automatic tags: put the condition name first on each answer line.
- Anything else (Stage 1 / Stage 2 stems, "Question 1 — Title (3 marks)", "Answer:" blocks) also parses when pasted, but the layout above is the one to generate.`;

/** Tiny sample in the guide's format, used by tests and as a paste example. */
export const FORMAT_SAMPLE_QUESTIONS = `CASE 01: DIZZINESS AFTER A COLD
MD2 short-answer questions | Total: 7 marks | Suggested time: 10 minutes

INSTRUCTIONS
- Answer in order.

CLINICAL STEM

A 42-year-old man presents with vertigo since yesterday. He had a cold last week.

QUESTION 1 (3 marks)

List THREE diagnoses that could account for his dizziness.

QUESTION 2 (4 marks)

Examination shows direction-fixed horizontal nystagmus.

a) State the most likely diagnosis. [1 marks]

b) Explain ONE finding that supports it. [3 marks]

TOTAL: 7 MARKS
`;

export const FORMAT_SAMPLE_ANSWERS = `CASE 01: DIZZINESS AFTER A COLD
EXPLAINED MODEL ANSWERS AND MARKING GUIDE | Total: 7 marks

MARKING PRINCIPLES
- Accept clinically equivalent answers.

QUESTION 1 (3 marks)

1. Vestibular neuritis
2. Labyrinthitis
3. Posterior circulation stroke

QUESTION 2 (4 marks)

a) State the most likely diagnosis. [1 marks]
- [1 marks] Vestibular neuritis.

b) Explain ONE finding that supports it. [3 marks]
- [2 marks] Direction-fixed nystagmus suggests a peripheral cause.
- [1 marks] Absence of central signs.

COMMON REASONING ERRORS
- Treating a recent cold as proof of a benign cause.
`;

export const FORMAT_SAMPLE_COVERAGE = `SAMPLE BANK — CONTENTS AND COVERAGE

01 — 7 marks — Dizziness after a cold
  Vestibular neuritis; Labyrinthitis; Posterior circulation stroke
`;
