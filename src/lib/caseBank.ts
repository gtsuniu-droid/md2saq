import { attachModelAnswer, parsePaper, type ParsedQuestion } from "./parser";
import type { SubPart } from "../data/types";

/**
 * Parser for generated case banks: one or more text files holding
 * "CASE 02: TITLE" papers (stem, numbered questions, lettered parts), matching
 * "EXPLAINED MODEL ANSWERS" files, and an optional contents-and-coverage file
 * listing each case's conditions.
 */

export interface CaseFile {
  name: string;
  text: string;
}

export interface ParsedCase {
  number: number;
  title: string;
  marks?: number;
  minutes?: number;
  instructions?: string;
  stem: string;
  questions: ParsedQuestion[];
  conditions: string[];
  hasAnswers: boolean;
  markingNotes?: string;
  debrief?: string;
}

export interface ParsedCaseBank {
  collection?: string;
  cases: ParsedCase[];
}

/** "CASE 02: TITLE", "SET 01: TITLE", "PAPER 3 - Title", "STATION 4: Title". */
const CASE_HEADER = /^\s*(?:CASE|SET|PAPER|STATION|SCENARIO)\s+(\d{1,3})\s*[:.\-–—]\s*(.+?)\s*$/i;
const RULE = /^\s*=+\s*$/;
/** "02 — 25 marks — Title" or "02 — Title — 25 marks". */
const COVERAGE_ROW_MARKS_FIRST = /^\s*(\d{1,3})\s*[—–-]\s*(\d+)\s*marks?\s*[—–-]\s*(.+?)\s*$/i;
const COVERAGE_ROW_TITLE_FIRST = /^\s*(\d{1,3})\s*[—–-]\s*(.+?)\s*[—–-]\s*(\d+)\s*marks?\s*$/i;
/** "DIZZINESS SAQ BANK — CONTENTS", "ABDOMINAL PAIN: 10 SAQ SETS", "CHEST PAIN — CASES 01–05". */
const BANK_TITLE = /^\s*(.+?)\s+[—–-]\s+(?:CASES?\b|SETS?\b|CONTENTS|EXPLAINED)|^\s*(.+?)\s*:\s*\d+\s+SAQ\b/i;

export function isCaseBank(files: CaseFile[]): boolean {
  return files.some((f) => f.text.split(/\r?\n/).some((l) => CASE_HEADER.test(l)));
}

function sentenceCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCaseBank(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w === "saq" ? "SAQ" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

interface Chunk {
  number: number;
  header: string;
  lines: string[];
  kind: "questions" | "answers";
}

function chunks(files: CaseFile[]): Chunk[] {
  const out: Chunk[] = [];
  for (const f of files) {
    const fromName: Chunk["kind"] | null =
      /answer/i.test(f.name) && !/question/i.test(f.name) ? "answers" : /question/i.test(f.name) ? "questions" : null;
    const lines = f.text.replace(/\r\n?/g, "\n").split("\n");
    let cur: Chunk | null = null;
    const close = () => {
      if (!cur) return;
      const head = cur.lines.slice(0, 3).join(" ");
      if (/EXPLAINED\s+MODEL\s+ANSWERS|MARKING\s+GUIDE|MODEL\s+ANSWERS/i.test(head)) cur.kind = "answers";
      else if (fromName) cur.kind = fromName;
      out.push(cur);
      cur = null;
    };
    for (const line of lines) {
      const h = CASE_HEADER.exec(line);
      if (h) {
        close();
        cur = { number: Number(h[1]), header: h[2], lines: [], kind: "questions" };
        continue;
      }
      if (!cur || RULE.test(line)) continue;
      cur.lines.push(line);
    }
    close();
  }
  return out;
}

interface Coverage {
  title: string;
  marks?: number;
  conditions: string[];
}

function coverage(files: CaseFile[]): Map<number, Coverage> {
  const map = new Map<number, Coverage>();
  for (const f of files) {
    const lines = f.text.replace(/\r\n?/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const a = COVERAGE_ROW_MARKS_FIRST.exec(lines[i]);
      const b = a ? null : COVERAGE_ROW_TITLE_FIRST.exec(lines[i]);
      if (!a && !b) continue;
      const number = Number((a ?? b)![1]);
      const marks = Number(a ? a[2] : b![3]);
      const title = (a ? a[3] : b![2]).trim();
      const conditions: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+\S/.test(lines[j]) && !COVERAGE_ROW_MARKS_FIRST.test(lines[j]) && !COVERAGE_ROW_TITLE_FIRST.test(lines[j])) {
        conditions.push(...lines[j].split(/;/).map((s) => s.trim()).filter(Boolean));
        j++;
      }
      map.set(number, { title, marks, conditions });
    }
  }
  return map;
}

function bankTitle(files: CaseFile[]): string | undefined {
  for (const f of files) {
    const first = f.text.split(/\r?\n/).find((l) => l.trim());
    const m = first ? BANK_TITLE.exec(first) : null;
    if (m) return titleCaseBank((m[1] ?? m[2]).trim());
  }
  return undefined;
}

const SECTION = /^\s*(INSTRUCTIONS|CLINICAL\s+STEM|STEM|SCENARIO|QUESTION\s+\d+.*|TOTAL\s*[:\-–—]?\s*\d+\s*MARKS?)\s*$/i;

function parseQuestionChunk(c: Chunk): Omit<ParsedCase, "conditions" | "hasAnswers"> {
  let marks: number | undefined;
  let minutes: number | undefined;
  const instructions: string[] = [];
  const stem: string[] = [];
  const questionLines: string[] = [];
  let section: "meta" | "instructions" | "stem" | "questions" | "done" = "meta";

  for (const line of c.lines) {
    const sec = SECTION.exec(line);
    if (sec) {
      const key = sec[1].toUpperCase();
      if (key.startsWith("INSTRUCTIONS")) section = "instructions";
      else if (key.startsWith("CLINICAL") || key === "STEM" || key === "SCENARIO") section = "stem";
      else if (key.startsWith("QUESTION")) {
        section = "questions";
        questionLines.push(line);
      } else section = "done";
      continue;
    }
    if (section === "meta") {
      const t = /total\s*[:\-–—]?\s*(\d+)\s*marks?/i.exec(line) ?? /\b(\d+)\s*marks?\b/i.exec(line);
      if (t) marks = Number(t[1]);
      const s = /suggested\s+time\s*[:\-–—]?\s*(\d+)\s*min/i.exec(line);
      if (s) minutes = Number(s[1]);
      continue;
    }
    if (section === "instructions") instructions.push(line);
    else if (section === "stem") stem.push(line);
    else if (section === "questions") questionLines.push(line);
  }

  const { questions } = parsePaper(questionLines.join("\n"));
  const stemText = stem.join("\n").trim();
  for (const q of questions) q.stems = stemText ? [stemText] : [];
  return {
    number: c.number,
    title: sentenceCase(c.header.trim()),
    marks,
    minutes,
    instructions: instructions.join("\n").trim().replace(/^\s*-\s*/gm, "- ") || undefined,
    stem: stemText,
    questions,
  };
}

const ANSWER_Q = /^\s*QUESTION\s+(\d{1,3})\b/i;
const DEBRIEF_HEADER = /^\s*(COMMON\s+REASONING\s+ERRORS|COMMON\s+ERRORS|CLINICAL\s+THINKING.*|CLINICAL\s+REFERENCES|REFERENCES|KEY\s+LEARNING.*|EXAMINER.*)\s*$/i;

interface Answers {
  byQuestion: Map<number, string>;
  markingNotes?: string;
  debrief?: string;
}

function parseAnswerChunk(c: Chunk): Answers {
  const byQuestion = new Map<number, string>();
  const preamble: string[] = [];
  const debrief: string[] = [];
  let current: number | null = null;
  let buf: string[] = [];
  let inDebrief = false;
  const flush = () => {
    if (current !== null) byQuestion.set(current, buf.join("\n").trim());
    buf = [];
  };
  for (const line of c.lines) {
    if (DEBRIEF_HEADER.test(line)) {
      flush();
      current = null;
      inDebrief = true;
    }
    if (inDebrief) {
      debrief.push(line);
      continue;
    }
    const q = ANSWER_Q.exec(line);
    if (q) {
      flush();
      current = Number(q[1]);
      continue;
    }
    if (current === null) preamble.push(line);
    else buf.push(line);
  }
  flush();
  const notes = preamble
    .filter((l) => !/EXPLAINED\s+MODEL\s+ANSWERS|MARKING\s+PRINCIPLES/i.test(l))
    .join("\n")
    .trim();
  return {
    byQuestion,
    markingNotes: notes || undefined,
    debrief: debrief.join("\n").trim() || undefined,
  };
}

/** Remove a repeated copy of the question wording from the top of a model answer. */
function stripRepeatedPrompt(answer: string, prompt: string): string {
  const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\[\d+\s*marks?\]/gi, "").trim().toLowerCase();
  const lines = answer.split("\n");
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && norm(lines[first]) === norm(prompt)) lines.splice(first, 1);
  return lines.join("\n").trim();
}

/** Attach answer text per question number to question-like objects (parsed or stored), splitting across parts. */
export function applyAnswers<Q extends { text: string; parts: SubPart[]; modelAnswer?: string }>(questions: Q[], byQuestion: Map<number, string>): number {
  let n = 0;
  questions.forEach((q, i) => {
    const text = byQuestion.get(i + 1);
    if (!text) return;
    const draft: ParsedQuestion = { stems: [], text: q.text, parts: q.parts.map((p) => ({ ...p })), modelAnswer: undefined };
    attachModelAnswer(draft, text);
    if (draft.parts.length === 0) draft.modelAnswer = stripRepeatedPrompt(draft.modelAnswer ?? "", q.text.split("\n")[0]) || draft.modelAnswer;
    for (const p of draft.parts) if (p.modelAnswer) p.modelAnswer = stripRepeatedPrompt(p.modelAnswer, p.text) || p.modelAnswer;
    q.modelAnswer = draft.modelAnswer;
    q.parts = draft.parts;
    n++;
  });
  return n;
}

export function parseCaseBank(files: CaseFile[]): ParsedCaseBank {
  const all = chunks(files);
  const cov = coverage(files);
  const answers = new Map<number, Answers>();
  for (const c of all) if (c.kind === "answers") answers.set(c.number, parseAnswerChunk(c));

  const cases: ParsedCase[] = [];
  const seen = new Set<number>();
  for (const c of all) {
    if (c.kind !== "questions") continue;
    // A dropped folder usually holds each case twice: in the combined file and in its own file.
    if (seen.has(c.number)) continue;
    seen.add(c.number);
    const parsed = parseQuestionChunk(c);
    const ans = answers.get(c.number);
    if (ans) {
      for (const q of parsed.questions) {
        if (q.number === undefined) continue;
        const text = ans.byQuestion.get(q.number);
        if (!text) continue;
        attachModelAnswer(q, text);
        if (q.parts.length === 0) q.modelAnswer = stripRepeatedPrompt(q.modelAnswer ?? "", q.text.split("\n")[0]) || q.modelAnswer;
        for (const p of q.parts) if (p.modelAnswer) p.modelAnswer = stripRepeatedPrompt(p.modelAnswer, p.text) || p.modelAnswer;
      }
    }
    const cv = cov.get(c.number);
    cases.push({
      ...parsed,
      title: cv?.title ?? parsed.title,
      marks: parsed.marks ?? cv?.marks,
      conditions: cv?.conditions ?? [],
      hasAnswers: !!ans && parsed.questions.some((q) => q.modelAnswer || q.parts.some((p) => p.modelAnswer)),
      markingNotes: ans?.markingNotes,
      debrief: ans?.debrief,
    });
  }
  cases.sort((a, b) => a.number - b.number);
  return { collection: bankTitle(files), cases };
}

/** Sets are named by case number; the case title travels separately. */
export interface ParsedAnswers {
  number: number;
  title: string;
  byQuestion: Map<number, string>;
  markingNotes?: string;
  debrief?: string;
}

/** Answer guides on their own, keyed by case number, for merging into sets already imported. */
export function parseAnswersOnly(files: CaseFile[]): ParsedAnswers[] {
  return chunks(files)
    .filter((c) => c.kind === "answers")
    .map((c) => ({ number: c.number, title: sentenceCase(c.header.trim()), ...parseAnswerChunk(c) }))
    .sort((a, b) => a.number - b.number);
}

export function hasQuestionChunks(files: CaseFile[]): boolean {
  return chunks(files).some((c) => c.kind === "questions");
}

export function caseSetName(c: ParsedCase): string {
  return `Case ${String(c.number).padStart(2, "0")}`;
}
