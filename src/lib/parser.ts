import type { SubPart } from "../data/types";

export interface ParsedQuestion {
  number?: number;
  text: string;
  marks?: number;
  modelAnswer?: string;
  parts: SubPart[];
}

/** "1." "1)" "Q1" "Q1." "Question 1:" "Question 1" — captures number and remainder. */
const NUMBERED_START =
  /^\s*(?:(?:q|question)\s*)?(\d{1,3})\s*(?:[.):\-–]|(?=\s)|$)\s*(.*)$/i;
/** "Question 1" / "Q1" style is a strong marker even when out of sequence. */
const STRONG_START = /^\s*(?:q|question)\s*(\d{1,3})\b/i;
/** Unnumbered "Q:" / "Question:" */
const UNNUMBERED_START = /^\s*(?:q|question)\s*[:.]\s*(.*)$/i;

const ANSWER_MARKER =
  /^\s*(?:model\s+answer|suggested\s+answer|sample\s+answer|answers?|marking\s+(?:guide|scheme|key|criteria)|solution|key|a)\s*[:\-–]\s*(.*)$/i;

const SUBPART =
  /^\s*\(?((?:[a-h])|(?:i{1,3}|iv|v|vi{1,3}|ix|x))\s*[.)]\s+(.*)$/i;
/** Numeric sub-parts "1)" "2." inside a question body (only accepted when they run 1, 2, 3…). */
const NUMERIC_SUBPART = /^\s*\(?(\d{1,2})\s*[.)]\s+(.*)$/;

const QUESTION_WORDS =
  /\b(list|outline|describe|what|name|explain|discuss|give|state|identify|suggest|which|how|why|define|compare|justify|interpret|calculate|write|provide)\b|\?\s*$/i;

function looksLikeQuestion(text: string): boolean {
  return QUESTION_WORDS.test(text);
}

const MARKS_PATTERNS: RegExp[] = [
  /\(\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)\s*\)/i,
  /\[\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)?\s*\]/i,
  /(?:^|\s)(\d+(?:\.\d+)?)\s*marks?\b/i,
  /\(\s*(\d+(?:\.\d+)?)\s*\)\s*$/,
];

export function extractMarks(text: string): { text: string; marks?: number } {
  for (const re of MARKS_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const marks = Number(m[1]);
      if (Number.isFinite(marks) && marks > 0 && marks <= 100) {
        const cleaned = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length))
          .replace(/\s{2,}/g, " ")
          .trim();
        return { text: cleaned, marks };
      }
    }
  }
  return { text: text.trim() };
}

function normalise(input: string): string[] {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/^\s*[•●◦▪]\s*/, "").replace(/\s+$/, ""));
}

interface Segment {
  number?: number;
  lines: string[];
}

/** Split lines into question segments using numbered starts. */
function segmentByNumber(lines: string[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let lastNumber = 0;
  let inAnswer = false;
  let lastAnswerListNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const strong = STRONG_START.exec(line);
    const numbered = NUMBERED_START.exec(line);
    const unnumbered = UNNUMBERED_START.exec(line);
    const prevBlank = i === 0 || lines[i - 1].trim() === "";

    let isStart = false;
    let number: number | undefined;
    let remainder = line;

    if (strong) {
      isStart = true;
      number = Number(strong[1]);
      remainder = numbered ? numbered[2] : line.replace(STRONG_START, "").replace(/^\s*[.):\-–]\s*/, "");
    } else if (unnumbered) {
      isStart = true;
      remainder = unnumbered[1];
    } else if (numbered) {
      const n = Number(numbered[1]);
      const sequential = n === lastNumber + 1;
      const firstOfDocument = current === null && (n === 1 || prevBlank);
      const listEnded = lastAnswerListNumber >= n;
      const accepted =
        firstOfDocument ||
        (sequential && (!inAnswer || prevBlank || listEnded || looksLikeQuestion(numbered[2])));
      if (accepted) {
        isStart = true;
        number = n;
        remainder = numbered[2];
      } else if (inAnswer) {
        lastAnswerListNumber = n;
      }
    }

    if (isStart) {
      if (current) segments.push(current);
      current = { number, lines: [remainder] };
      if (number !== undefined) lastNumber = number;
      inAnswer = false;
      lastAnswerListNumber = 0;
      continue;
    }

    if (ANSWER_MARKER.test(line)) inAnswer = true;
    if (!current) current = { lines: [] };
    current.lines.push(line);
  }
  if (current) segments.push(current);
  return segments.filter((s) => s.lines.some((l) => l.trim() !== ""));
}

/** Fallback: split on blank lines, attaching answer and sub-part blocks to the preceding block. */
function segmentByBlank(lines: string[]): Segment[] {
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (cur.length) blocks.push(cur);
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push(cur);

  const segments: Segment[] = [];
  for (const block of blocks) {
    const first = block[0];
    const attaches = ANSWER_MARKER.test(first) || SUBPART.test(first);
    const last = segments[segments.length - 1];
    if (attaches && last) {
      last.lines.push("", ...block);
    } else {
      segments.push({ lines: block });
    }
  }
  return segments;
}

function buildQuestion(seg: Segment): ParsedQuestion {
  const lines = seg.lines;
  let answerLines: string[] | null = null;
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (answerLines) {
      answerLines.push(line);
      continue;
    }
    const m = ANSWER_MARKER.exec(line);
    if (m) {
      answerLines = m[1].trim() ? [m[1]] : [];
      continue;
    }
    bodyLines.push(line);
  }

  const parts: SubPart[] = [];
  const stemLines: string[] = [];
  let currentPart: SubPart | null = null;
  for (const line of bodyLines) {
    const sp = SUBPART.exec(line);
    const np = NUMERIC_SUBPART.exec(line);
    if (sp) {
      currentPart = { label: sp[1].toLowerCase(), text: sp[2] };
      parts.push(currentPart);
    } else if (np && Number(np[1]) === parts.length + 1) {
      currentPart = { label: np[1], text: np[2] };
      parts.push(currentPart);
    } else if (currentPart) {
      currentPart.text += (currentPart.text ? "\n" : "") + line;
    } else {
      stemLines.push(line);
    }
  }

  let marks: number | undefined;
  const stemRaw = stemLines.join("\n").trim();
  const stemExtract = extractMarks(stemRaw);
  marks = stemExtract.marks;

  let partsTotal = 0;
  for (const part of parts) {
    const e = extractMarks(part.text.trim());
    part.text = e.text;
    if (e.marks !== undefined) {
      part.marks = e.marks;
      partsTotal += e.marks;
    }
  }
  if (marks === undefined && partsTotal > 0) marks = partsTotal;

  const modelAnswer = answerLines ? answerLines.join("\n").trim() : undefined;
  if (modelAnswer && parts.length > 0) distributeModelAnswer(modelAnswer, parts);

  return {
    number: seg.number,
    text: stemExtract.text,
    marks,
    modelAnswer: modelAnswer || undefined,
    parts,
  };
}

/** If the model answer is sectioned by the same labels as the parts, attach each section to its part. */
function distributeModelAnswer(modelAnswer: string, parts: SubPart[]): void {
  const lines = modelAnswer.split("\n");
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines) {
    const m = /^\s*\(?([a-z]|\d{1,2}|i{1,3}|iv|v|vi{1,3}|ix|x)\s*[.):]\s*(.*)$/i.exec(line);
    const label = m ? m[1].toLowerCase() : null;
    if (label && parts.some((p) => p.label === label) && !sections.has(label)) {
      current = label;
      sections.set(label, m![2] ? [m![2]] : []);
    } else if (current) {
      sections.get(current)!.push(line);
    }
  }
  if (sections.size < Math.min(2, parts.length)) return;
  for (const part of parts) {
    const sec = sections.get(part.label);
    if (sec) part.modelAnswer = sec.join("\n").trim() || undefined;
  }
}

export function parseQuestions(input: string): ParsedQuestion[] {
  const lines = normalise(input);
  if (lines.every((l) => l.trim() === "")) return [];

  let segments = segmentByNumber(lines);
  if (segments.length < 2) {
    const byBlank = segmentByBlank(lines);
    if (byBlank.length > segments.length) segments = byBlank;
  }
  return segments.map(buildQuestion).filter((q) => q.text || q.parts.length);
}

/** Flatten a question to a single searchable string. */
export function questionFullText(q: { text: string; parts: SubPart[] }): string {
  return [q.text, ...q.parts.map((p) => `(${p.label}) ${p.text}`)].join("\n");
}
