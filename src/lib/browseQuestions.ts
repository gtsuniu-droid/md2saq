import type { Attempt, Mark } from "../data/types";
import { primaryPresentation } from "./primaryPresentation";
import { browseSetTitle } from "./browseSets";
import type { SetSummary } from "./sets";

/**
 * Browse's questions view: every question the student has had marked, once each (its latest
 * marked sitting), to find the ones that went badly or the ones sat most recently.
 */
export interface MarkedQuestion { attemptId: string; summary: SetSummary; question: SetSummary["questions"][number]; number: number; score: number; maxScore: number; percent: number; at: number }
export type QuestionSort = "worst" | "latest";

export function markedQuestions(summaries: SetSummary[], attempts: Attempt[], marks: Mark[]): MarkedQuestion[] {
  const latestMark = new Map<string, Mark>();
  for (const m of marks) if ((latestMark.get(m.attemptId)?.markedAt ?? -1) <= m.markedAt) latestMark.set(m.attemptId, m);
  const byQuestion = new Map<string, { attempt: Attempt; mark: Mark }>();
  for (const a of attempts) {
    const mark = a.submittedAt !== undefined ? latestMark.get(a.id) : undefined;
    if (!mark || mark.maxScore <= 0) continue;
    const cur = byQuestion.get(a.questionId);
    if (!cur || cur.attempt.submittedAt! < a.submittedAt!) byQuestion.set(a.questionId, { attempt: a, mark });
  }
  const out: MarkedQuestion[] = [];
  for (const summary of summaries) {
    summary.questions.forEach((question, i) => {
      const hit = byQuestion.get(question.id);
      if (!hit) return;
      out.push({ attemptId: hit.attempt.id, summary, question, number: i + 1, score: hit.mark.score, maxScore: hit.mark.maxScore, percent: Math.round((100 * hit.mark.score) / hit.mark.maxScore), at: hit.attempt.submittedAt! });
    });
  }
  return out;
}

/** Search the set's title and the question's words; the presentation is the set's. */
export function browseQuestions(rows: MarkedQuestion[], search: string, presentation: string, sort: QuestionSort): MarkedQuestion[] {
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (presentation && (primaryPresentation(row.summary.set, row.summary.questions) ?? "unassigned") !== presentation) return false;
    const text = [browseSetTitle(row.summary), ...(row.question.stems ?? []), row.question.text, ...row.question.parts.map((p) => p.text)].join("\n").toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  }).sort(sort === "latest" ? (a, b) => b.at - a.at || a.percent - b.percent : (a, b) => a.percent - b.percent || b.at - a.at);
}
