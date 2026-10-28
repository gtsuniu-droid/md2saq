import type { Attempt, Question, QuestionSet } from "../data/types";
import { introducedStems } from "./markingSet";
import { answerParts } from "./questions";

/**
 * A submitted set laid out for someone else to mark: the case, each question and part with
 * its marks, the student's answer and the model answer. Copied as text from the marking page,
 * and kept in the student's private store so their connected assistant can read it and send
 * back suggested marks. Pure, so the site and its functions share it.
 */
export interface MarkingPart { id: string; label: string; marks: number; prompt: string; answer: string; model: string }
export interface MarkingQuestion { attemptId: string; number: number; stems: string[]; text: string; model: string; parts: MarkingPart[] }
export interface SetForMarking { key: string; name: string; at: number; notes?: string; questions: MarkingQuestion[] }

/** Suggested marks for one part: a score, a line of feedback, and comments on quoted passages of the answer. */
export interface SuggestedPart { attemptId: string; label: string; score: number; feedback: string; comments: { quote: string; text: string; start: number; end: number }[] }
export interface SuggestedMarks { at: number; summary?: string; parts: SuggestedPart[] }

/** "1(a)", or "2" for a question without parts: how a part is named in the text and by the connector. */
export const partId = (number: number, label: string): string => label ? `${number}(${label})` : String(number);

/** Plain text of a rich document, for model answers that were only kept with formatting. */
type DocNode = { type?: string; text?: string; content?: DocNode[] };
export function docText(doc: unknown): string {
  const lines: string[] = [];
  const inline = (n: DocNode): string => n.type === "text" ? n.text ?? "" : (n.content ?? []).map(inline).join(n.type === "tableRow" ? " | " : " ");
  const walk = (n: DocNode, prefix: string): void => {
    if (n.type === "paragraph" || n.type === "heading" || n.type === "tableRow") { lines.push(prefix + inline(n).trim()); return; }
    // A list item's first line carries the bullet; what follows (a nested list) is indented under it.
    (n.content ?? []).forEach((c, i) => walk(c, n.type === "listItem" ? (i === 0 ? `${prefix}- ` : `${prefix}  `) : prefix));
  };
  if (doc && typeof doc === "object") walk(doc as DocNode, "");
  return lines.filter((l) => l.replace(/^[\s-]*/, "")).join("\n");
}

const modelOf = (answer: { modelAnswer?: string; modelAnswerDoc?: unknown }): string => answer.modelAnswer?.trim() || (answer.modelAnswerDoc ? docText(answer.modelAnswerDoc) : "");

export function buildSetForMarking(key: string, name: string, rows: { question?: Question; attempt?: Attempt; order: number }[], set?: QuestionSet): SetForMarking {
  const questions: MarkingQuestion[] = [];
  let previous: Question | undefined;
  for (const { question, attempt, order } of rows) {
    if (!question || attempt?.submittedAt === undefined) { previous = question ?? previous; continue; }
    const number = order + 1;
    const parts = answerParts(question).map((p) => ({
      id: partId(number, p.label), label: p.label, marks: p.marks ?? 0, prompt: p.text.trim(),
      answer: attempt.answers.find((a) => a.label === p.label)?.text ?? "", model: modelOf(p),
    }));
    // A model answer for the whole question, when the parts have none of their own.
    const whole = question.parts.length > 0 && !parts.some((p) => p.model) ? modelOf(question) : "";
    questions.push({ attemptId: attempt.id, number, stems: introducedStems(question, previous).map((s) => s.text.trim()), text: question.text.trim(), model: whole, parts });
    previous = question;
  }
  const at = Math.max(0, ...rows.map((r) => r.attempt?.submittedAt ?? 0));
  return { key, name, at, ...(set?.markingNotes?.trim() ? { notes: set.markingNotes.trim() } : {}), questions };
}

/** The set as text to paste anywhere: a marker gets everything they need, in reading order. */
export function setText(s: SetForMarking): string {
  const out = [`Please mark my answers to this short-answer question set. For each part, give a score out of its marks and brief feedback, following the model answer${s.notes ? " and marking notes" : ""}.`, "", `# ${s.name}`];
  for (const q of s.questions) {
    for (const stem of q.stems) out.push("", stem);
    const marks = q.parts.reduce((sum, p) => sum + p.marks, 0);
    out.push("", `## Question ${q.number}${marks ? ` [${marks} mark${marks === 1 ? "" : "s"}]` : ""}`, ...(q.text ? [q.text] : []));
    for (const p of q.parts) {
      if (p.label) out.push("", `### ${p.id}${p.marks ? ` [${p.marks} mark${p.marks === 1 ? "" : "s"}]` : ""}`, ...(p.prompt ? [p.prompt] : []));
      out.push("", "My answer:", p.answer.trim() || "(no answer)");
      if (p.model) out.push("", "Model answer:", p.model);
    }
    if (q.model) out.push("", `Model answer for question ${q.number}:`, q.model);
  }
  if (s.notes) out.push("", "## Marking notes", s.notes);
  return out.join("\n");
}

/**
 * Suggested marks checked against the set: every part named must exist, scores are capped at the
 * part's marks, and a comment's quote must appear word for word in the answer. What passes is
 * kept; the rest comes back as problems, so whoever sent it can correct and send again.
 */
export function checkSuggested(s: SetForMarking, input: { part: string; score: number; feedback?: string; comments?: { quote: string; comment: string }[] }[], summary?: string, now = Date.now()): { marks: SuggestedMarks; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map(s.questions.flatMap((q) => q.parts.map((p) => [p.id.toLowerCase().replace(/\s+/g, ""), { q, p }] as const)));
  const parts: SuggestedPart[] = [];
  for (const m of input) {
    const hit = byId.get(m.part.toLowerCase().replace(/\s+/g, ""));
    if (!hit) { problems.push(`No part ${m.part} in this set; parts are ${[...byId.values()].map(({ p }) => p.id).join(", ")}.`); continue; }
    const { q, p } = hit;
    if (!Number.isFinite(m.score) || m.score < 0) { problems.push(`${p.id}: the score must be a number of marks.`); continue; }
    const score = p.marks ? Math.min(m.score, p.marks) : m.score;
    if (p.marks && m.score > p.marks) problems.push(`${p.id}: ${m.score} is more than its ${p.marks} marks, so ${p.marks} was kept.`);
    const comments = (m.comments ?? []).flatMap((c) => {
      const start = c.quote ? p.answer.indexOf(c.quote) : -1;
      if (start < 0 || !c.comment?.trim()) { problems.push(`${p.id}: "${c.quote.slice(0, 60)}" is not in the answer word for word; that comment was left out.`); return []; }
      return [{ quote: c.quote, text: c.comment.trim(), start, end: start + c.quote.length }];
    });
    parts.push({ attemptId: q.attemptId, label: p.label, score, feedback: (m.feedback ?? "").trim(), comments });
  }
  return { marks: { at: now, ...(summary?.trim() ? { summary: summary.trim() } : {}), parts }, problems };
}
