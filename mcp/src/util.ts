import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BankError, PasscodeMissingError, ReadOnlyModeError } from "./client.js";
import type { BankEntry, Question, SetPack, SubPart } from "./types.js";
import { presentationName } from "./presentations.js";

/** Success: the object as JSON text plus structuredContent, so clients can show either. */
export function ok(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

/** Failure: isError with a plain message and, where useful, a hint about what to do instead. */
export function fail(error: unknown, context: Record<string, unknown> = {}): CallToolResult {
  const data: Record<string, unknown> = { success: false, error: error instanceof Error ? error.message : String(error), ...context };
  if (error instanceof ReadOnlyModeError) data.hint = "Start the server without --read-only (and without SAQ_READ_ONLY) to allow changes.";
  else if (error instanceof PasscodeMissingError) data.hint = "Add SAQ_PASSCODE to the server's environment; it is the admin passcode from the site's Netlify settings.";
  else if (error instanceof BankError && error.status === 403) data.hint = "The passcode must match BANK_PASSCODE on the site exactly.";
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: true };
}

export function setLabel(entry: Pick<BankEntry, "number" | "name" | "presentations" | "group">): string {
  const number = entry.number !== undefined ? `Set ${String(entry.number).padStart(2, "0")}` : entry.name;
  const where = entry.group ?? entry.presentations[0];
  return where ? `${presentationName(where)} — ${number}` : number;
}

export { presentationName } from "./presentations.js";

export function partLabel(label: string): string {
  return label ? `(${label})` : "";
}

/** A compact, readable view of one question, with ids so edits can target it. */
export function describeQuestion(q: Question, index: number) {
  return {
    number: index + 1,
    questionId: q.id,
    stems: q.stems ?? [],
    text: q.text,
    marks: q.marks,
    modelAnswer: q.modelAnswer,
    hasRichText: !!q.textDoc,
    hasRichModelAnswer: !!q.modelAnswerDoc,
    parts: q.parts.map((p) => ({ label: p.label, text: p.text, marks: p.marks, modelAnswer: p.modelAnswer, hasRichText: !!p.textDoc, hasRichModelAnswer: !!p.modelAnswerDoc })),
    presentations: q.presentations,
    images: (q.images as { id: string; caption?: string; place: string }[] | undefined)?.map((im) => ({ id: im.id, place: im.place, caption: im.caption })) ?? [],
  };
}

/** Find a question in a pack by its 1-based number or its id. */
export function findQuestion(pack: SetPack, ref: { number?: number; questionId?: string }): { question: Question; index: number } {
  const ordered = [...pack.questions].sort((a, b) => a.order - b.order);
  let index = -1;
  if (ref.questionId) index = ordered.findIndex((q) => q.id === ref.questionId);
  else if (ref.number !== undefined) index = ref.number - 1;
  if (index < 0 || index >= ordered.length) throw new BankError(`No question ${ref.questionId ?? ref.number} in this set; it has ${ordered.length}. getSet lists them with their numbers and ids.`, 404);
  return { question: ordered[index], index };
}

export function findPart(question: Question, label: string): SubPart {
  const part = question.parts.find((p) => p.label.toLowerCase() === label.toLowerCase());
  if (!part) throw new BankError(`Question has no part "${label}". Its parts are: ${question.parts.map((p) => p.label).join(", ") || "none"}.`, 404);
  return part;
}

export function plainText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

/** Everything in the set's text that a search should look at. */
export function searchableText(pack: SetPack): string {
  const parts = [pack.set.name, pack.set.source ?? "", pack.set.collection ?? "", ...(pack.set.tags ?? [])];
  for (const q of pack.questions) parts.push(...(q.stems ?? []), q.text, q.modelAnswer ?? "", ...q.parts.flatMap((p) => [p.text, p.modelAnswer ?? ""]));
  return parts.join("\n").toLowerCase();
}

const COMMAND_WORDS = ["state", "list", "name", "give", "identify", "outline", "describe", "explain", "justify", "compare", "contrast", "interpret", "classify", "categorise", "categorize", "prioritise", "prioritize", "discuss", "suggest", "define", "calculate", "propose", "summarise", "summarize", "rank", "predict", "assess", "evaluate", "distinguish", "differentiate", "recommend", "write", "draw", "label", "indicate", "select", "choose", "formulate", "devise", "plan", "set out", "for each"];
const CHATTY = /\b(could you|can you|would you|what do you think|please|i would like|tell me|let's|lets)\b/i;

/** Examination language: a command word first, no conversational phrasing. Returns the problems found, if any. */
export function examStyleWarnings(label: string, text: string): string[] {
  const t = text.trim().toLowerCase().replace(/^[("'\[]+/, "");
  const out: string[] = [];
  if (t && !COMMAND_WORDS.some((w) => t.startsWith(w + " ") || t.startsWith(w + ",") || t.startsWith(w + ":"))) out.push(`${label} does not open with an examination command word (State, List, Outline, Explain, Justify…).`);
  if (CHATTY.test(text)) out.push(`${label} uses conversational phrasing; rewrite it as an instruction.`);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const sentences = text.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;
  if (words > 45) out.push(`${label} is ${words} words; keep a question under about 45 words (at most three short sentences). Move background into the stem or split it into parts.`);
  else if (sentences > 3) out.push(`${label} has ${sentences} sentences; keep to three at most.`);
  return out;
}

/** Style warnings for a whole question: its text when it has no parts, otherwise each part. */
export function questionStyleWarnings(q: Question, number: number): string[] {
  if (!q.parts.length) return examStyleWarnings(`Question ${number}`, q.text);
  return q.parts.flatMap((p) => examStyleWarnings(`Question ${number}${partLabel(p.label)}`, p.text));
}

/** Strip bookkeeping prefixes such as "Case 02:" or "Set 3 -" from a title; numbering is automatic. */
export function cleanTitle(text: string | undefined): string {
  return (text ?? "").replace(/^\s*(?:case|set|station|scenario)\s*\d*\s*[:.\-–—]?\s*/i, "").trim();
}

/** The descriptive title of a set, or empty when it only has a generic name. */
export function entryTitle(e: { name: string; source?: string; number?: number }): string {
  const fromSource = cleanTitle(e.source);
  if (fromSource) return fromSource;
  return /^(set|case)\s*\d*$/i.test(e.name.trim()) ? "" : cleanTitle(e.name);
}

/** What is weak about a set's metadata, in words a user can act on. */
export function metadataWarnings(e: { name: string; source?: string; tags?: string[] }): string[] {
  const out: string[] = [];
  const raw = (e.source ?? e.name ?? "").trim();
  if (!entryTitle(e)) out.push("no descriptive title");
  else if (/^\s*(case|set|station|scenario)\s*\d*\s*[:.\-–—]/i.test(raw)) out.push(`title carries a bookkeeping prefix ("${raw.slice(0, 24)}…")`);
  else if (entryTitle(e).split(/\s+/).length > 14) out.push("title is long; aim for under ten words");
  const tags = (e.tags ?? []).filter(Boolean);
  if (!tags.length) out.push("no tags; tags should name the conditions the case covers");
  else if (tags.length === 1) out.push("only one tag");
  return out;
}

const answered = (q: Question): boolean => q.parts.length ? q.parts.every((p) => !!((p.modelAnswer ?? "").trim() || p.modelAnswerDoc)) : !!((q.modelAnswer ?? "").trim() || q.modelAnswerDoc);
export { answered as hasModelAnswers };

/** A set as a readable document: stems once per stage, numbered questions, parts and marks, answers optional. */
export function packToMarkdown(heading: { code: string; label: string }, pack: SetPack, includeAnswers: boolean): string {
  const { set } = pack;
  const ordered = [...pack.questions].sort((a, b) => a.order - b.order);
  const title = entryTitle({ name: set.name, source: set.source, number: set.number });
  const lines: string[] = [`# ${heading.label}${title ? `: ${title}` : ""}`, ``, `Code \`${heading.code}\`${set.tags?.length ? ` · Tags: ${set.tags.join(", ")}` : ""}${set.collection ? ` · Collection: ${set.collection}` : ""}${set.suggestedMinutes ? ` · ${set.suggestedMinutes} min` : ""}`];
  if (set.instructions) lines.push(``, `> ${set.instructions.replace(/\n/g, "\n> ")}`);
  const shown = new Set<string>();
  ordered.forEach((q, i) => {
    (q.stems ?? []).forEach((stem, stage) => {
      if (shown.has(stem)) return;
      shown.add(stem);
      lines.push(``, `**Stage ${stage + 1}.** ${stem}`);
    });
    lines.push(``, `**${i + 1}.** ${q.text}${q.marks !== undefined && !q.parts.length ? ` *(${q.marks} marks)*` : ""}`);
    for (const p of q.parts) lines.push(`   **(${p.label})** ${p.text}${p.marks !== undefined ? ` *(${p.marks} marks)*` : ""}`);
    if (includeAnswers) {
      if (q.modelAnswer) lines.push(``, `   *Answer:*`, ...q.modelAnswer.split("\n").map((l) => `   ${l}`));
      for (const p of q.parts) if (p.modelAnswer) lines.push(``, `   *Answer (${p.label}):*`, ...p.modelAnswer.split("\n").map((l) => `   ${l}`));
    }
  });
  if (set.markingNotes) lines.push(``, `## Marking notes`, set.markingNotes);
  if (set.debrief) lines.push(``, `## Debrief`, set.debrief);
  return lines.join("\n");
}

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const countAsked = (text: string): { n: number; capitals: boolean } | null => {
  const m = /\b(?:list|name|give|state|identify|outline|describe|suggest|propose)\s+(?:the\s+|up\s+to\s+|at\s+least\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.exec(text);
  if (!m) return null;
  const raw = m[1];
  const n = /^\d+$/.test(raw) ? Number(raw) : COUNT_WORDS[raw.toLowerCase()];
  return n ? { n, capitals: raw === raw.toUpperCase() } : null;
};
const lines = (t: string | undefined) => (t ?? "").split("\n").map((l) => l.trim()).filter(Boolean).length;

export interface QualityIssue { severity: "fix" | "check"; issue: string }

/** Everything a reviewer would raise about one question: style, marks, counts and answers. */
export function questionQualityIssues(q: Question, number: number): QualityIssue[] {
  const out: QualityIssue[] = [];
  const label = (p?: SubPart) => `Question ${number}${p ? `(${p.label})` : ""}`;
  for (const w of questionStyleWarnings(q, number)) out.push({ severity: "fix", issue: w });
  const targets: { text: string; marks?: number; answer?: string; answerDoc?: unknown; part?: SubPart }[] = q.parts.length
    ? q.parts.map((p) => ({ text: p.text, marks: p.marks, answer: p.modelAnswer, answerDoc: p.modelAnswerDoc, part: p }))
    : [{ text: q.text, marks: q.marks, answer: q.modelAnswer, answerDoc: q.modelAnswerDoc }];
  if (!(q.stems?.length)) out.push({ severity: "check", issue: `${label()} has no case stem.` });
  for (const t of targets) {
    const words = t.text.trim().split(/\s+/).filter(Boolean).length;
    if (words < 4) out.push({ severity: "fix", issue: `${label(t.part)} is only ${words} word${words === 1 ? "" : "s"}; a question needs a task, not a heading.` });
    if (t.marks === undefined) out.push({ severity: "fix", issue: `${label(t.part)} has no marks.` });
    else if (t.marks === 0) out.push({ severity: "check", issue: `${label(t.part)} is worth 0 marks.` });
    const asked = countAsked(t.text);
    if (asked && !asked.capitals) out.push({ severity: "check", issue: `${label(t.part)} asks for ${asked.n} items; write the number in capitals (e.g. ${["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"][asked.n] ?? asked.n}).` });
    if (asked && t.marks !== undefined && t.marks < asked.n) out.push({ severity: "check", issue: `${label(t.part)} asks for ${asked.n} items but carries ${t.marks} mark${t.marks === 1 ? "" : "s"}.` });
    if (asked && t.marks !== undefined && t.marks > asked.n * 3) out.push({ severity: "check", issue: `${label(t.part)} asks for ${asked.n} items but carries ${t.marks} marks; say what else earns credit.` });
    const hasAnswer = !!((t.answer ?? "").trim() || t.answerDoc);
    if (!hasAnswer) out.push({ severity: "fix", issue: `${label(t.part)} has no model answer.` });
    else if (!t.answerDoc && t.marks !== undefined && t.marks >= 3 && lines(t.answer) < 2) out.push({ severity: "check", issue: `${label(t.part)} is worth ${t.marks} marks but its model answer is a single line; one point per line helps marking.` });
    if (/\b(etc|and so on)\b\.?/i.test(t.text)) out.push({ severity: "check", issue: `${label(t.part)} trails off with "etc."; say exactly what is wanted.` });
  }
  if (q.parts.length === 1) out.push({ severity: "check", issue: `${label()} has a single part (${q.parts[0].label}); fold it into the question.` });
  return out;
}
