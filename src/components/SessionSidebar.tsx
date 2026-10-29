import { hasAnswerContent } from "../lib/answerContent";
import { useEffect, useReducer, useRef } from "react";
import type { Attempt, Mark, Question, QuestionSet, Session } from "../data/types";
import type { MarkingDraft } from "../lib/markingSet";
import { loadMarkingDraft, MARKING_DRAFT_EVENT } from "../lib/markingDrafts";
import { markBand, sidebarEntries } from "../lib/sidebarEntries";

interface Props {
  session: Session; questions: Question[]; attempts: Attempt[];
  /** The session's sets, for the headings between them, and its marks, for each part's score. */
  sets: QuestionSet[]; marks: Mark[];
  activePart: string; summaryOpen: boolean;
  onQuestion: (index: number, part?: string) => void;
}

export default function SessionSidebar({ session, questions, attempts, sets, marks, activePart, summaryOpen, onQuestion }: Props) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { currentRef.current?.scrollIntoView({ block: "nearest" }); }, [session.index, activePart, summaryOpen]);
  // Scores typed on the marking page show here at once, before they are saved, from this tab or another.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener(MARKING_DRAFT_EVENT, redraw);
    window.addEventListener("storage", redraw);
    return () => { window.removeEventListener(MARKING_DRAFT_EVENT, redraw); window.removeEventListener("storage", redraw); };
  }, []);
  const latest = new Map<string, Mark>();
  for (const m of marks) if ((latest.get(m.attemptId)?.markedAt ?? -1) < m.markedAt) latest.set(m.attemptId, m);
  const drafts = new Map<string, MarkingDraft>();
  attempts.forEach((a, i) => {
    const draft = a && questions[i] ? loadMarkingDraft(a.ownerId ?? "", a.id, questions[i].id, latest.get(a.id)) : null;
    if (draft) drafts.set(a.id, draft);
  });
  return <aside className="paper-side session-sidebar" aria-label="Session navigation">
    <nav aria-label="Opened questions">{sidebarEntries(session, questions, attempts, sets, marks, activePart, drafts).map((entry) => {
      if (entry.kind === "set") return <div key={entry.key} className="side-set" title={entry.title}>{entry.label}{entry.allMarked && <span className="side-set-done" aria-label=", all marked"> ✓</span>}</div>;
      const { row, score, unanswered } = entry;
      const attempt = attempts[row.index];
      const answer = attempt?.answers.find((a) => a.label === row.part);
      const current = row.current && !summaryOpen;
      const band = score ? markBand(score) : "";
      return <button key={entry.key} ref={current ? currentRef : undefined}
        className={(current ? "current " : "") + (attempt?.submittedAt !== undefined || hasAnswerContent(answer) ? "done" : "") + (score ? ` marked${band ? ` mark-${band}` : ""}` : "")}
        aria-current={current ? "step" : undefined}
        aria-label={`Question ${row.label}${answer?.flagged ? ", flagged" : ""}${unanswered ? ", not answered" : ""}${score ? `, marked ${score.score} out of ${score.maxScore}` : ""}`}
        onClick={() => onQuestion(row.index, row.part)}>
        {row.label}{answer?.flagged && <span className="flag" aria-hidden="true">⚑</span>}
        {unanswered ? <span className="side-mark" title={score ? `Not answered, ${score.score}/${score.maxScore}` : "Not answered"} aria-hidden="true">–</span>
          : score && <span className="side-mark" title={`${score.score}/${score.maxScore}`} aria-hidden="true">✓</span>}
      </button>;
    })}</nav>
  </aside>;
}
