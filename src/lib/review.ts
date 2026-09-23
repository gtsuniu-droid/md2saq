import type { Question } from "../data/types";
import type { HistoryEntry } from "./history";
import { primaryPresentation } from "./primaryPresentation";
import { presentationName } from "../data/presentations";

export const WEAK_SCORE_PERCENT = 60;
export function savedReviewNotes(entry: HistoryEntry): string {
  return [entry.mark?.notes, entry.mark?.reflection, entry.mark?.learningPoint, ...(entry.attempt.answerComments ?? []).map((c) => `“${c.quote}”\n${c.text}`)].filter((text) => text?.trim()).join("\n\n");
}

/** Latest marked attempt per question: a successful unaided retry replaces old weaknesses. */
export function reviewTopics(entries: HistoryEntry[], questions: Question[] = entries.flatMap((e) => e.question ? [e.question] : [])) {
  const latest = new Map<string, HistoryEntry>();
  for (const entry of [...entries].sort((a, b) => b.attempt.submittedAt! - a.attempt.submittedAt!)) {
    if (!entry.mark) continue;
    const key = entry.attempt.questionId;
    if (!latest.has(key)) latest.set(key, entry);
  }
  const topics = new Map<string, { id: string; name: string; entries: { entry: HistoryEntry; reasons: string[]; pct: number | null }[] }>();
  for (const entry of latest.values()) {
    const mark = entry.mark;
    if (!mark) continue;
    const pct = mark.maxScore > 0 ? 100 * mark.score / mark.maxScore : null;
    const reasons: string[] = [];
    if (mark.lookedAtAnswer) reasons.push("Looked at answer");
    if (pct !== null && pct < WEAK_SCORE_PERCENT) reasons.push("Below 60%");
    if (mark.reviewLater && !mark.lookedAtAnswer) reasons.push("Flagged");
    if (!reasons.length) continue;
    const members = questions.filter((q) => q.setId === entry.set?.id);
    const id = entry.set ? primaryPresentation(entry.set, members) ?? "other" : entry.question?.presentations[0] ?? "other";
    const topic = topics.get(id) ?? { id, name: id === "other" ? "Other saved questions" : presentationName(id), entries: [] };
    topic.entries.push({ entry, reasons, pct });
    topics.set(id, topic);
  }
  return [...topics.values()].map((topic) => ({ ...topic, entries: topic.entries.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)) }))
    .sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name));
}
