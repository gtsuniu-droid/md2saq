import type { SubPart } from "../data/types";

export interface ParsedQuestion {
  number?: number;
  /** Case stems that precede this question, in order (cumulative across stages). */
  stems: string[];
  text: string;
  marks?: number;
  modelAnswer?: string;
  modelAnswerDoc?: unknown;
  parts: SubPart[];
}

export interface PaperMeta {
  title?: string;
  minutes?: number;
  totalMarks?: number;
}

export interface ParsedPaper {
  questions: ParsedQuestion[];
  meta: PaperMeta;
}

/** "1." "1)" "Q1" "Q1." "Question 1:" "Question 1" — captures number and remainder. */
const NUMBERED_START =
  /^\s*(?:(?:q|question)\s*)?(\d{1,3})\s*(?:[.):\-–—]|(?=\s)|$)\s*(.*)$/i;
/** "Question 1" / "Q1" style is a strong marker even when out of sequence. */
const STRONG_START = /^\s*(?:q|question)\s*(\d{1,3})\b/i;
/** Unnumbered "Q:" / "Question:" */
const UNNUMBERED_START = /^\s*(?:q|question)\s*[:.]\s*(.*)$/i;

const ANSWER_MARKER =
  /^\s*(?:model\s+answers?|suggested\s+answers?|sample\s+answers?|expected\s+answers?|worked\s+answers?|answer\s+key|answers?|marking\s+(?:guide|scheme|key|criteria)|mark\s+scheme|solutions?|key|a)\s*[:\-–—]\s*(.*)$/i;

const SUBPART =
  /^\s*(?:part\s+)?\(?((?:[a-h])|(?:i{1,3}|iv|v|vi{1,3}|ix|x))\s*[.):]\s+(.*)$/i;
/** Numeric sub-parts "1)" "2." inside a question body (only accepted when they run 1, 2, 3…). */
const NUMERIC_SUBPART = /^\s*\(?(\d{1,2})\s*[.)]\s+(.*)$/;

/** "Stage 1", "Stage 2:", "Part B", "Scenario", "Case 1 — title" on a line of their own. */
const STAGE_HEADER = /^\s*(?:stage|part|scenario|case|vignette|update)\s*(?:\d{1,2}|[a-h])?\s*(?:[:.\-–—]\s*(.*))?$/i;
const TOTAL_LINE = /^\s*total\s*[:\-–—]?\s*\d+(?:\.\d+)?\s*marks?\.?\s*$/i;
const TITLE_LINE = /^\s*(?:saq|title|case|topic)\s*[:\-–—]\s*(.+?)(?:\s*[—–-]\s*(\d+)\s*marks?)?\s*$/i;
const TIME_LINE = /^\s*(?:suggested\s+)?time\s*(?:allowed|limit)?\s*[:\-–—]?\s*(\d+)\s*(?:min|mins|minutes)\b/i;

const QUESTION_WORDS =
  /\b(list|outline|describe|what|name|explain|discuss|give|state|identify|suggest|which|how|why|define|compare|justify|interpret|calculate|write|provide)\b|\?\s*$/i;

function looksLikeQuestion(text: string): boolean {
  return QUESTION_WORDS.test(text);
}

const MARKS_PATTERNS: RegExp[] = [
  /\(\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)\s*\)/i,
  /\(?\s*marks?\s*[:=]\s*(\d+(?:\.\d+)?)\s*\)?/i,
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
    .map(demarkdown);
}

/**
 * Strip the markdown that AI generators add: heading hashes, bold and italic
 * markers around headers, block quotes, horizontal rules, and bullet glyphs.
 */
function demarkdown(line: string): string {
  let l = line.replace(/\s+$/, "");
  l = l.replace(/^\s*#{1,6}\s+/, "");
  l = l.replace(/^\s*>\s?/, "");
  if (/^\s*(?:[-*_]\s*){3,}$/.test(l)) return "";
  l = l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
  l = l.replace(/^\s*\*(?!\s)([^*]+?)\*\s*$/, "$1").replace(/^\s*_(?!\s)([^_]+?)_\s*$/, "$1");
  l = l.replace(/^\s*[•●◦▪]\s*/, "");
  return l;
}

interface Segment {
  number?: number;
  lines: string[];
  stems: string[];
}

interface Segmented {
  segments: Segment[];
  meta: PaperMeta;
}

/** Split lines into question segments using numbered starts, collecting stage stems along the way. */
function segmentByNumber(lines: string[]): Segmented {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let lastNumber = 0;
  let inAnswer = false;
  let lastAnswerListNumber = 0;
  const meta: PaperMeta = {};
  const stems: string[] = [];
  let stageLines: string[] | null = null;
  let sawStage = false;
  const preamble: string[] = [];

  const closeStage = () => {
    if (stageLines) {
      const text = stageLines.join("\n").trim();
      if (text) stems.push(text);
      stageLines = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TOTAL_LINE.test(line)) {
      meta.totalMarks = Number(/\d+(?:\.\d+)?/.exec(line)![0]);
      continue;
    }
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
      remainder = numbered ? numbered[2] : line.replace(STRONG_START, "").replace(/^\s*[.):\-–—]\s*/, "");
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
      closeStage();
      if (current) segments.push(current);
      current = { number, lines: [remainder], stems: [...stems] };
      if (number !== undefined) lastNumber = number;
      inAnswer = false;
      lastAnswerListNumber = 0;
      continue;
    }

    const stage = STAGE_HEADER.exec(line);
    if (stage && !inAnswer) {
      closeStage();
      if (current) {
        segments.push(current);
        current = null;
      }
      sawStage = true;
      stageLines = stage[1]?.trim() ? [stage[1].trim()] : [];
      continue;
    }

    if (stageLines) {
      stageLines.push(line);
      continue;
    }

    if (ANSWER_MARKER.test(line)) inAnswer = true;
    if (!current) {
      // Before the first question: preamble (title, time, instructions) when stages exist,
      // otherwise the text belongs to the first question.
      preamble.push(line);
      continue;
    }
    current.lines.push(line);
  }
  closeStage();
  if (current) segments.push(current);

  for (const line of preamble) {
    const t = TITLE_LINE.exec(line);
    if (t && !meta.title) {
      meta.title = t[1].trim();
      if (t[2]) meta.totalMarks = meta.totalMarks ?? Number(t[2]);
    }
    const m = TIME_LINE.exec(line);
    if (m && !meta.minutes) meta.minutes = Number(m[1]);
  }
  const preambleText = preamble.join("\n").trim();
  if (!sawStage && preambleText && segments.length > 0 && segments[0].lines.length > 0 && !TITLE_LINE.test(preambleText.split("\n")[0])) {
    // No stages: the leading text is the first question's stem, as before.
    segments.unshift({ lines: preamble, stems: [] });
  }

  return {
    segments: segments.filter((s) => s.lines.some((l) => l.trim() !== "")),
    meta,
  };
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
      segments.push({ lines: block, stems: [] });
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
    stems: seg.stems,
    text: stemExtract.text,
    marks,
    modelAnswer: modelAnswer || undefined,
    parts,
  };
}

/** Attach a model answer to a parsed question, splitting it across parts when sectioned by their labels. */
export function attachModelAnswer(q: ParsedQuestion, modelAnswer: string): void {
  const text = modelAnswer.trim();
  if (!text) return;
  q.modelAnswer = text;
  q.modelAnswerDoc = undefined;
  if (q.parts.length > 0) distributeModelAnswer(text, q.parts);
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
    if (sec) {
      part.modelAnswer = sec.join("\n").trim() || undefined;
      part.modelAnswerDoc = undefined;
    }
  }
}

export function parsePaper(input: string): ParsedPaper {
  const lines = normalise(input);
  if (lines.every((l) => l.trim() === "")) return { questions: [], meta: {} };

  const numbered = segmentByNumber(lines);
  let segments = numbered.segments;
  if (segments.length < 2) {
    const byBlank = segmentByBlank(lines);
    if (byBlank.length > segments.length) segments = byBlank;
  }
  return { questions: segments.map(buildQuestion).filter((q) => q.text || q.parts.length), meta: numbered.meta };
}

export function parseQuestions(input: string): ParsedQuestion[] {
  return parsePaper(input).questions;
}

/** Flatten a question to a single searchable string. */
export function questionFullText(q: { text: string; parts: SubPart[] }): string {
  return [q.text, ...q.parts.map((p) => `(${p.label}) ${p.text}`)].join("\n");
}
