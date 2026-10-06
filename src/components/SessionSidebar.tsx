import { hasAnswerContent } from "../lib/answerContent";
import { useEffect, useRef } from "react";
import type { Attempt, Question, Session } from "../data/types";
import { sessionQuestionRows } from "../lib/sessionNavigation";

interface Props {
  session: Session; questions: Question[]; attempts: Attempt[];
  activePart: string; summaryOpen: boolean;
  onQuestion: (index: number, part?: string) => void;
}
export default function SessionSidebar({ session, questions, attempts, activePart, summaryOpen, onQuestion }: Props) {
  const currentRef = useRef<HTMLButtonElement>(null);
  const rows = sessionQuestionRows(session, questions, activePart);
  useEffect(() => { currentRef.current?.scrollIntoView({ block: "nearest" }); }, [session.index, activePart, summaryOpen]);
  return <aside className="paper-side session-sidebar" aria-label="Session navigation">
    <nav aria-label="Opened questions">{rows.map((row) => {
      const attempt = attempts[row.index];
      const answer = attempt?.answers.find((a) => a.label === row.part);
      const current = row.current && !summaryOpen;
      return <button key={`${row.index}-${row.part}`} ref={current ? currentRef : undefined}
        className={(current ? "current " : "") + (attempt?.submittedAt !== undefined || hasAnswerContent(answer) ? "done" : "")}
        aria-current={current ? "step" : undefined}
        aria-label={`Question ${row.label}${answer?.flagged ? ", flagged" : ""}`}
        onClick={() => onQuestion(row.index, row.part)}>
        {row.label}{answer?.flagged && <span className="flag" aria-hidden="true">⚑</span>}
      </button>;
    })}</nav>
  </aside>;
}
