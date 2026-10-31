import type { Attempt, Question, QuestionSet } from "../data/types";
import { introducedStems } from "./markingSet";
import { answerParts } from "./questions";

/**
 * A submitted set laid out for someone else to mark: the case, each question and part with
 * its marks, the student's answer and the model answer. Copied as text from the marking page,
 * and kept in the student's private store so their connected assistant can read it and send
 * back suggested marks. Pure, so the site and its functions share it.
 */
export interface MarkingPart { id: string; label: string; marks: number; prompt: string; answer: string; model: string; /** The student's own revision after reading the model answer, when they made one. */ revised?: string }
export interface MarkingQuestion { attemptId: string; number: number; stems: string[]; text: string; model: string; parts: MarkingPart[]; /** The set this question opens, when the paper holds several sets (an exam). */ section?: string }
export interface SetForMarking { key: string; name: string; at: number; notes?: string; questions: MarkingQuestion[]; /** A whole exam paper: every set of the sitting, numbered right through. */ exam?: boolean }

/** Suggested marks for one part: a score, a line of feedback, and comments on quoted passages of the answer. */
export interface SuggestedPart { attemptId: string; label: string; score: number; feedback: string; comments: { quote: string; text: string; start: number; end: number }[]; /** The student's answer rewritten for full marks in their own words, when it fell short. */ rewrite?: string }
export interface SuggestedMarks { at: number; summary?: string; parts: SuggestedPart[] }

/**
 * How to mark, wherever marking is asked for (the connector, Mark with AI, Copy set, Copy exam):
 * as an expert, evidence-based consultant examining finals would, strictly, with the model answer
 * as the guide and their own clinical reasoning rather than a blind reading of it, and a high-yield
 * pearl in each part's feedback.
 */
export const MARKING_RULES = [
  "Mark strictly, as an expert consultant doctor examining finals would, using your own clinical reasoning and current evidence-based practice. The model answer and marking notes are your guide to what earns marks, not a script to follow blindly: a mark is earned by a point they credit, or by a point an expert consultant would accept as its clinical equivalent on the evidence (the same drug or investigation named another way, a more precise version of the same point, the current guideline's choice), stated specifically and correctly; follow the mark shown against each point, e.g. [1 mark].",
  "No marks for vague, generic or implied points (\"order bloods\", \"manage symptoms\", \"refer\"), for being on the right track, or for a credited point that is clinically wrong for this patient. Never give the benefit of the doubt. Where the model answer itself is clinically doubtful or behind current evidence, say so in the feedback and mark what an expert consultant would accept today.",
  "When a question asks for a number of items (e.g. THREE), mark only the first that many; later ones earn nothing, and a wrong item still uses up its place.",
  "A point contradicted elsewhere in the answer earns nothing. Half marks only where the model answer or notes allow them; never round up, never exceed a part's marks.",
  "In each part's feedback, reason as a clinician: say which points earned marks, which were missed and why they matter for this patient, then end with one high-yield clinical pearl for this question (a fact that wins marks or a trap to avoid), written as a plain closing sentence with no label.",
];

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
    const parts = answerParts(question).map((p) => {
      const a = attempt.answers.find((x) => x.label === p.label);
      const revised = a?.revision?.text.trim();
      return { id: partId(number, p.label), label: p.label, marks: p.marks ?? 0, prompt: p.text.trim(), answer: a?.text ?? "", model: modelOf(p), ...(revised && revised !== a?.text.trim() ? { revised } : {}) };
    });
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
  const out = [`Please mark my answers to this ${s.exam ? "exam paper" : "short-answer question set"}: a score out of its marks for each part, and feedback, against the model answer${s.notes ? " and marking notes" : ""}.`, "", ...MARKING_RULES.map((r) => `- ${r}`), "", `# ${s.name}`];
  for (const q of s.questions) {
    if (q.section) out.push("", `# ${q.section}`);
    for (const stem of q.stems) out.push("", stem);
    const marks = q.parts.reduce((sum, p) => sum + p.marks, 0);
    out.push("", `## Question ${q.number}${marks ? ` [${marks} mark${marks === 1 ? "" : "s"}]` : ""}`, ...(q.text ? [q.text] : []));
    for (const p of q.parts) {
      if (p.label) out.push("", `### ${p.id}${p.marks ? ` [${p.marks} mark${p.marks === 1 ? "" : "s"}]` : ""}`, ...(p.prompt ? [p.prompt] : []));
      out.push("", "My answer:", p.answer.trim() || "(no answer)");
      if (p.revised) out.push("", "My revised answer, after reading the model answer:", p.revised);
      if (p.model) out.push("", "Model answer:", p.model);
    }
    if (q.model) out.push("", `Model answer for question ${q.number}:`, q.model);
  }
  if (s.notes) out.push("", "## Marking notes", s.notes);
  return out.join("\n");
}

/**
 * What to say to an assistant with the SAQ Practice connector so it marks the set, or the whole
 * exam paper, and sends the marks back to the marking page.
 */
export function markPrompt(s: SetForMarking): string {
  const sets = s.questions.filter((q) => q.section).length;
  const last = s.questions[s.questions.length - 1]?.number ?? s.questions.length;
  return [
    `Using the SAQ Practice connector: mark my answers to ${s.exam ? `my whole exam paper "${s.name}"` : `"${s.name}"`} (set id ${s.key}).`,
    ...(s.exam ? [`It is one paper of ${sets} sets and ${last} questions, numbered 1 to ${last} right through; mark the whole paper in one go and send every part together.`] : []),
    `Read them with getMyAnswers (set: "${s.key}") and mark every part strictly, as an expert, evidence-based consultant doctor examining finals would, following its howToMark with your own clinical reasoning: marks for points the model answer credits, or an expert consultant would accept as their clinical equivalent on current evidence, stated specifically; nothing for vague points, for items beyond the number asked, or for points wrong for this patient; no benefit of the doubt.`,
    `Quote the passages of my answers you comment on, end each part's feedback with one high-yield clinical pearl as a plain sentence, and where a part fell short include a rewrite of my answer that would earn full marks in my own words; then send it all with markMyAnswers (set: "${s.key}").`,
    "I will check and save them on the marking page.",
  ].join("\n");
}

/**
 * Suggested marks checked against the set: every part named must exist, scores are capped at the
 * part's marks, and a comment's quote must appear word for word in the answer. What passes is
 * kept; the rest comes back as problems, so whoever sent it can correct and send again.
 */
export function checkSuggested(s: SetForMarking, input: { part: string; score: number; feedback?: string; comments?: { quote: string; comment: string }[]; rewrite?: string }[], summary?: string, now = Date.now()): { marks: SuggestedMarks; problems: string[] } {
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
    // A rewrite is kept only where it changes something; the full-marks answer is the student's own otherwise.
    const rewrite = (m.rewrite ?? "").trim().slice(0, 10_000);
    parts.push({ attemptId: q.attemptId, label: p.label, score, feedback: (m.feedback ?? "").trim(), comments, ...(rewrite && rewrite !== p.answer.trim() ? { rewrite } : {}) });
  }
  return { marks: { at: now, ...(summary?.trim() ? { summary: summary.trim() } : {}), parts }, problems };
}
