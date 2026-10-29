import { hasAnswerContent } from "./answerContent";
import type { Attempt, Mark, PartMark, Question, QuestionSet, Session } from "../data/types";
import { sessionQuestionRows, sessionSetGroups } from "./sessionNavigation";
import { setLabel } from "./sets";
import { scoreBand, type ScoreBand } from "./scoreBand";
import { answerParts } from "./questions";
import type { MarkingDraft } from "./markingSet";

/** What the paper's question list shows; the list itself is components/SessionSidebar. */
type Row = ReturnType<typeof sessionQuestionRows>[number];

/** How a marked part went, for the colour of its row: the same bands as the scores on the home page. */
export const markBand = (mark: Pick<PartMark, "score" | "maxScore">): ScoreBand | "" => mark.maxScore > 0 ? scoreBand((100 * mark.score) / mark.maxScore) : "";
export type SidebarEntry =
  | { kind: "set"; key: string; label: string; title?: string; allMarked: boolean }
  | { kind: "part"; key: string; row: Row; score?: PartMark; unanswered: boolean };

/**
 * What the sidebar lists: each opened part, with its mark once it has one, and, when the session
 * has more than one set, a heading where each set starts, numbered in the order the sets come up.
 * A part's mark is its saved one, or the score given in an unsaved marking draft, which is newer.
 */
export function sidebarEntries(session: Session, questions: Question[], attempts: Attempt[], sets: QuestionSet[], marks: Mark[], activePart: string, drafts: Map<string, MarkingDraft> = new Map()): SidebarEntry[] {
  const latest = new Map<string, Mark>();
  for (const m of marks) if ((latest.get(m.attemptId)?.markedAt ?? -1) < m.markedAt) latest.set(m.attemptId, m);
  const scoreOf = (index: number, label: string): PartMark | undefined => {
    const attempt = attempts[index];
    if (!attempt) return undefined;
    const draft = drafts.get(attempt.id);
    if (draft?.scored?.includes(label)) return draft.parts.find((p) => p.label === label);
    return latest.get(attempt.id)?.parts.find((p) => p.label === label);
  };
  const groups = sessionSetGroups(session, questions);
  const setById = new Map(sets.map((s) => [s.id, s]));
  const out: SidebarEntry[] = [];
  for (const row of sessionQuestionRows(session, questions, activePart)) {
    const g = groups.length > 1 ? groups.findIndex((group) => group.indices[0] === row.index) : -1;
    if (g >= 0 && !out.some((e) => e.key === `set-${groups[g].setId}`)) {
      const set = setById.get(groups[g].setId);
      // The bank's own label and name, for hovering.
      const title = set ? [setLabel(set), set.name].filter((t, i, all) => t && all.indexOf(t) === i).join(": ") : undefined;
      const allMarked = groups[g].indices.every((i) => answerParts(questions[i]).every((p) => scoreOf(i, p.label)));
      out.push({ kind: "set", key: `set-${groups[g].setId}`, label: `Set ${g + 1}`, title, allMarked });
    }
    const attempt = attempts[row.index];
    // Submitted with nothing written for this part.
    const unanswered = attempt?.submittedAt !== undefined && !hasAnswerContent(attempt.answers.find((a) => a.label === row.part));
    out.push({ kind: "part", key: `${row.index}-${row.part}`, row, score: scoreOf(row.index, row.part), unanswered });
  }
  return out;
}
