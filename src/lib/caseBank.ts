import { attachModelAnswer, parsePaper, type ParsedQuestion } from "./parser";
import type { SubPart } from "../data/types";

/**
 * Parser for generated case banks: one or more text files holding papers
 * headed "CASE 02: TITLE", "SET 01: TITLE" or "VOM-01 | Title" (stem, numbered
 * questions, lettered parts). Answers may come as separate "EXPLAINED MODEL
 * ANSWERS" files keyed by question, or sit inline under each question or part
 * as "Answer:" / "Credit:" bullets, in the same file or another one. An
 * optional contents file lists each case's conditions, as "01 — 25 marks —
 * Title" rows with indented conditions or "VOM-01: Title — 23 marks" rows with
 * "Coverage:" lines.
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
/** "VOM-01 | Title", "ABD-03: Title — explained answers". */
const CODE_HEADER = /^\s*([A-Z]{2,8})-(\d{1,3})\s*[|:\-–—]\s*(.+?)\s*$/;
/** What a header's trailing " — explained answers" says about the chunk. */
const HEADER_SUFFIX = /\s*[—–-]\s*(questions\s+and\s+answers|explained\s+(?:model\s+)?answers|model\s+answers|answers|questions)\s*$/i;
const END_LINE = /^\s*END\s+OF\b/i;
const RULE = /^\s*(?:=+|#{3,}|-{5,}|_{5,}|\*{5,})\s*$/;
/** "02 — 25 marks — Title" or "02 — Title — 25 marks". */
const COVERAGE_ROW_MARKS_FIRST = /^\s*(\d{1,3})\s*[—–-]\s*(\d+)\s*marks?\s*[—–-]\s*(.+?)\s*$/i;
const COVERAGE_ROW_TITLE_FIRST = /^\s*(\d{1,3})\s*[—–-]\s*(.+?)\s*[—–-]\s*(\d+)\s*marks?\s*$/i;
/** "VOM-01: Title — 23 marks", followed by "Coverage: a, b, c" lines. */
const COVERAGE_ROW_CODE = /^\s*[A-Z]{2,8}-(\d{1,3})\s*[:|]\s*(.+?)\s*[—–-]\s*(\d+)\s*marks?\s*$/;
/** "DIZZINESS SAQ BANK — CONTENTS", "ABDOMINAL PAIN: 10 SAQ SETS", "VOMITING SAQs — QUESTIONS AND ANSWERS", "VOMITING: MD2 ...". */
const BANK_TITLE = /^\s*(.+?)\s+[—–-]\s+(?:CASES?\b|SETS?\b|CONTENTS|EXPLAINED|QUESTIONS|ANSWERS)|^\s*(.+?)\s*:\s*(?:\d+\s+SAQ|MD2)\b/i;

const QUESTION_LINE = /^\s*(?:question|q)\s*(\d{1,3})\b/i;
const PART_LINE = /^\s*\(?([a-h])\)\s+(.*)$/i;
/** Inline answer block under a question or part. */
const INLINE_ANSWER = /^\s*(?:credit|answers?|model\s+answers?|suggested\s+answers?|expected\s+answers?)\s*:\s*(.*)$/i;
const MARKING_LINE = /^\s*marking\s*:\s*(.*)$/i;
const GENERIC_MARKING = /^award\s+1\s+mark\s+(?:per|for\s+each)\b/i;
const TEACHING_LINE = /^\s*(?:teaching\s+note|note|explanation)\b[^:]*:\s*(.*)$/i;
const SOURCE_LINE = /^\s*relevant\s+\S.*sources?\s*(?:\(s\))?\s*:/i;

export function isCaseBank(files: CaseFile[]): boolean {
  return files.some((f) => f.text.split(/\r?\n/).some((l) => caseHeader(l) !== null));
}

function caseHeader(line: string): { number: number; header: string } | null {
  if (END_LINE.test(line)) return null;
  const h = CASE_HEADER.exec(line);
  if (h) return { number: Number(h[1]), header: h[2] };
  const c = CODE_HEADER.exec(line);
  if (c) return { number: Number(c[2]), header: c[3] };
  return null;
}

function sentenceCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCaseBank(s: string): string {
  if (s.replace(/SAQs/g, "SAQ") !== s.toUpperCase().replace(/SAQS/g, "SAQ")) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w === "saq" ? "SAQ" : w === "saqs" ? "SAQs" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

type Kind = "questions" | "answers" | "both";

interface Chunk {
  number: number;
  header: string;
  lines: string[];
  kind: Kind;
}

function hasInlineAnswers(lines: string[]): boolean {
  return lines.some((l) => INLINE_ANSWER.test(l)) && lines.some((l) => QUESTION_LINE.test(l) || PART_LINE.test(l));
}

function chunks(files: CaseFile[]): Chunk[] {
  const out: Chunk[] = [];
  for (const f of files) {
    const nameSaysQ = /question/i.test(f.name);
    const nameSaysA = /answer/i.test(f.name);
    const fromName: Kind | null = nameSaysQ && nameSaysA ? "both" : nameSaysA ? "answers" : nameSaysQ ? "questions" : null;
    const lines = f.text.replace(/\r\n?/g, "\n").split("\n");
    let cur: Chunk | null = null;
    const close = () => {
      if (!cur) return;
      const suffix = HEADER_SUFFIX.exec(cur.header);
      if (suffix) {
        cur.header = cur.header.replace(HEADER_SUFFIX, "").trim();
        const s = suffix[1].toLowerCase();
        cur.kind = s.startsWith("questions and") ? "both" : s.endsWith("answers") ? "answers" : "questions";
      } else {
        const head = cur.lines.slice(0, 3).join(" ");
        if (/EXPLAINED\s+(?:MODEL\s+)?ANSWERS|MARKING\s+GUIDE|MODEL\s+ANSWERS/i.test(head)) cur.kind = "answers";
        else if (fromName) cur.kind = fromName;
        else if (hasInlineAnswers(cur.lines)) cur.kind = "both";
      }
      out.push(cur);
      cur = null;
    };
    for (const line of lines) {
      const h = caseHeader(line);
      if (h) {
        close();
        cur = { number: h.number, header: h.header, lines: [], kind: "questions" };
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

function splitConditions(text: string): string[] {
  const sep = text.includes(";") ? /;/ : /,/;
  return text.split(sep).map((s) => s.trim()).filter(Boolean);
}

function coverage(files: CaseFile[]): Map<number, Coverage> {
  const map = new Map<number, Coverage>();
  const isRow = (l: string) => COVERAGE_ROW_MARKS_FIRST.test(l) || COVERAGE_ROW_TITLE_FIRST.test(l) || COVERAGE_ROW_CODE.test(l);
  for (const f of files) {
    const lines = f.text.replace(/\r\n?/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const a = COVERAGE_ROW_MARKS_FIRST.exec(lines[i]);
      const b = a ? null : COVERAGE_ROW_TITLE_FIRST.exec(lines[i]);
      const c = a || b ? null : COVERAGE_ROW_CODE.exec(lines[i]);
      if (!a && !b && !c) continue;
      const number = Number((a ?? b ?? c)![1]);
      const marks = Number(a ? a[2] : (b ?? c)![3]);
      const title = (a ? a[3] : (b ?? c)![2]).trim();
      const conditions: string[] = [];
      // Old rows list conditions on indented lines; coded rows on "Coverage:" lines that may wrap.
      let j = i + 1;
      let inCoverage = false;
      while (j < lines.length && lines[j].trim() && !isRow(lines[j])) {
        const cov = /^\s*coverage\s*:\s*(.*)$/i.exec(lines[j]);
        if (cov) {
          inCoverage = true;
          conditions.push(...splitConditions(cov[1]));
        } else if (inCoverage || /^\s+\S/.test(lines[j])) {
          conditions.push(...splitConditions(lines[j]));
        } else break;
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

/** Answers found inline under questions and parts, with teaching notes kept apart for the debrief. */
interface Inline {
  questionLines: string[];
  byQuestion: Map<number, string>;
  notes: string[];
}

/**
 * Separate the answer blocks from the question wording. Each question's
 * answer is rebuilt in the sectioned shape ("a) prompt" then its bullets) that
 * attachModelAnswer splits across parts. "Marking:" and "Teaching note:" text
 * is not a marking point; it goes to the notes, labelled by question and part.
 */
function splitInlineAnswers(lines: string[]): Inline {
  const questionLines: string[] = [];
  const answers = new Map<number, string[]>();
  const notes: string[] = [];
  let qn: number | null = null;
  let part: string | null = null;
  let mode: "q" | "a" | "note" = "q";
  const where = () => `Q${qn}${part ? ` (${part})` : ""}`;
  for (const line of lines) {
    if (END_LINE.test(line) || SOURCE_LINE.test(line)) continue;
    const q = QUESTION_LINE.exec(line);
    if (q) {
      qn = Number(q[1]);
      part = null;
      mode = "q";
      questionLines.push(line);
      continue;
    }
    const p = qn !== null && mode !== "note" ? PART_LINE.exec(line) : null;
    if (p) {
      part = p[1].toLowerCase();
      mode = "q";
      questionLines.push(line);
      if (!answers.has(qn!)) answers.set(qn!, []);
      // A bare label line, so the part's section holds only its answer bullets.
      answers.get(qn!)!.push(`${part})`);
      continue;
    }
    const ans = qn !== null ? INLINE_ANSWER.exec(line) : null;
    if (ans) {
      mode = "a";
      if (!answers.has(qn!)) answers.set(qn!, []);
      if (ans[1].trim()) answers.get(qn!)!.push(ans[1].trim());
      continue;
    }
    const marking = qn !== null ? MARKING_LINE.exec(line) : null;
    if (marking) {
      mode = "note";
      if (!GENERIC_MARKING.test(marking[1].trim())) notes.push(`${where()} marking: ${marking[1].trim()}`);
      else notes.push("");
      continue;
    }
    const teaching = qn !== null ? TEACHING_LINE.exec(line) : null;
    if (teaching) {
      mode = "note";
      notes.push(`${where()}: ${teaching[1].trim()}`);
      continue;
    }
    if (!line.trim()) {
      if (mode === "note") mode = "q";
      if (mode === "q") questionLines.push(line);
      continue;
    }
    if (mode === "a") answers.get(qn!)!.push(line);
    else if (mode === "note") {
      if (notes[notes.length - 1] !== "") notes[notes.length - 1] += " " + line.trim();
    } else questionLines.push(line);
  }
  const byQuestion = new Map<number, string>();
  for (const [n, ls] of answers) {
    const text = ls.join("\n").trim();
    if (text) byQuestion.set(n, text);
  }
  return { questionLines, byQuestion, notes: notes.filter(Boolean) };
}

interface ParsedChunk extends Omit<ParsedCase, "conditions" | "hasAnswers"> {
  inline?: Inline;
}

function parseQuestionChunk(c: Chunk): ParsedChunk {
  let marks: number | undefined;
  let minutes: number | undefined;
  const instructions: string[] = [];
  const stem: string[] = [];
  let questionLines: string[] = [];
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
      } else {
        // "TOTAL: 25 MARKS" closes the paper when it follows the questions; at the top it is the marks line.
        const t = /(\d+)\s*marks?/i.exec(key);
        if (t && marks === undefined) marks = Number(t[1]);
        if (section === "questions") section = "done";
      }
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
    else if (section === "questions") {
      if (END_LINE.test(line)) section = "done";
      else questionLines.push(line);
    }
  }

  let inline: Inline | undefined;
  if (hasInlineAnswers(questionLines)) {
    inline = splitInlineAnswers(questionLines);
    questionLines = inline.questionLines;
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
    inline,
  };
}

const ANSWER_Q = /^\s*QUESTION\s+(\d{1,3})\b/i;
const DEBRIEF_HEADER = /^\s*(COMMON\s+REASONING\s+ERRORS|COMMON\s+ERRORS|CLINICAL\s+THINKING.*|CLINICAL\s+REFERENCES|REFERENCES\b.*|KEY\s+LEARNING.*|EXAMINER.*)\s*$/i;

interface Answers {
  byQuestion: Map<number, string>;
  markingNotes?: string;
  debrief?: string;
}

function parseAnswerChunk(c: Chunk): Answers {
  // Answers laid out like the paper itself, with "Credit:" under each part.
  if (hasInlineAnswers(c.lines)) {
    const firstQ = c.lines.findIndex((l) => QUESTION_LINE.test(l));
    const body: string[] = [];
    const debrief: string[] = [];
    let inDebrief = false;
    for (const line of c.lines.slice(Math.max(0, firstQ))) {
      if (DEBRIEF_HEADER.test(line)) inDebrief = true;
      (inDebrief ? debrief : body).push(line);
    }
    const inline = splitInlineAnswers(body);
    const tail = [...inline.notes, ...(debrief.length ? ["", ...debrief] : [])].join("\n").trim();
    return { byQuestion: inline.byQuestion, debrief: tail || undefined };
  }

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
    .filter((l) => !/EXPLAINED\s+(?:MODEL\s+)?ANSWERS|MARKING\s+PRINCIPLES/i.test(l))
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

function attach(parsed: ParsedChunk, byQuestion: Map<number, string>): void {
  for (const q of parsed.questions) {
    if (q.number === undefined) continue;
    const text = byQuestion.get(q.number);
    if (!text) continue;
    attachModelAnswer(q, text);
    if (q.parts.length === 0) q.modelAnswer = stripRepeatedPrompt(q.modelAnswer ?? "", q.text.split("\n")[0]) || q.modelAnswer;
    for (const p of q.parts) if (p.modelAnswer) p.modelAnswer = stripRepeatedPrompt(p.modelAnswer, p.text) || p.modelAnswer;
  }
}

export function parseCaseBank(files: CaseFile[]): ParsedCaseBank {
  const all = chunks(files);
  const cov = coverage(files);
  const answers = new Map<number, Answers>();
  for (const c of all) if (c.kind === "answers") answers.set(c.number, parseAnswerChunk(c));

  // A dropped folder usually holds each case twice (combined file and its own file), and a
  // contents file may open with the same header: keep the copy that actually has questions.
  const best = new Map<number, ParsedChunk>();
  for (const c of all) {
    if (c.kind === "answers") continue;
    const parsed = parseQuestionChunk(c);
    const have = best.get(c.number);
    if (!have || (have.questions.length === 0 && parsed.questions.length > 0)) best.set(c.number, parsed);
  }

  const cases: ParsedCase[] = [];
  for (const parsed of best.values()) {
    if (parsed.questions.length === 0) continue;
    const separate = answers.get(parsed.number);
    const inline = parsed.inline;
    const ans: Answers | undefined = separate ?? (inline && inline.byQuestion.size ? { byQuestion: inline.byQuestion, debrief: inline.notes.join("\n").trim() || undefined } : undefined);
    if (ans) attach(parsed, ans.byQuestion);
    const cv = cov.get(parsed.number);
    const { inline: _i, ...rest } = parsed;
    void _i;
    cases.push({
      ...rest,
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
  return chunks(files).some((c) => c.kind !== "answers" && c.lines.some((l) => QUESTION_LINE.test(l)));
}

export function caseSetName(c: ParsedCase): string {
  return `Case ${String(c.number).padStart(2, "0")}`;
}
