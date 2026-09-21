import type { Attempt, Question, QuestionSet, Session } from "../data/types";
import { answerParts, partLabel } from "../lib/questions";
import { openedSetCount, sessionSetGroups } from "../lib/sessionNavigation";
import { setLabel } from "../lib/sets";

interface Props {
  session: Session; questions: Question[]; attempts: Attempt[]; sets: QuestionSet[];
  activePart: string; summaryOpen: boolean;
  onSummary: () => void; onQuestion: (index: number, part?: string) => void;
}
export default function SessionSidebar({ session, questions, attempts, sets, activePart, summaryOpen, onSummary, onQuestion }: Props) {
  const groups = sessionSetGroups(session, questions);
  const opened = groups.slice(0, openedSetCount(session, groups));
  const activeGroup = groups.find((group) => group.indices.includes(session.index));
  const completed = attempts.filter((a) => a.submittedAt !== undefined).length;
  const setMode = session.studyUnit === "sets";
  const visibleIndices = setMode ? activeGroup?.indices ?? [] : questions.map((_, index) => index);
  return <aside className="session-sidebar" aria-label="Session navigation">
    <div className="session-progress"><strong>{completed}</strong><span>of {questions.length} questions submitted</span><progress value={completed} max={questions.length} aria-label="Submitted questions" /></div>
    <button className={`session-summary-button${summaryOpen ? " selected" : ""}`} aria-pressed={summaryOpen} onClick={onSummary}>Summary</button>
    {setMode && <>
      <div className="session-nav-heading">Sets <span>{opened.length} / {groups.length} opened</span></div>
      <nav className="session-set-numbers" aria-label="Opened sets">{opened.map((group, number) => {
        const set = sets.find((s) => s.id === group.setId);
        const done = group.indices.every((i) => attempts[i]?.submittedAt !== undefined);
        const current = group === activeGroup && !summaryOpen;
        return <button key={group.setId} className={(current ? "current " : "") + (done ? "done" : "")} aria-current={current ? "step" : undefined} aria-label={`Open set ${number + 1}: ${set ? setLabel(set) : "Set"}${done ? ", submitted" : ""}`} title={set?.name} onClick={() => onQuestion(group.indices[0])}>{number + 1}</button>;
      })}</nav>
      <div className="session-current-set">{sets.find((s) => s.id === activeGroup?.setId)?.name || "Current set"}</div>
    </>}
    <div className="session-nav-heading">Questions</div>
    <nav className="session-question-numbers" aria-label="Questions in the current set">{visibleIndices.flatMap((i) => answerParts(questions[i]).map((part) => {
      const attempt = attempts[i];
      const answer = attempt?.answers.find((a) => a.label === part.label);
      const current = !summaryOpen && i === session.index && (part.label === activePart || answerParts(questions[i]).length === 1);
      const label = `${setMode ? questions[i].order + 1 : i + 1}${part.label ? ` ${partLabel(part.label)}` : ""}`;
      return <button key={`${i}-${part.label}`} className={(current ? "current " : "") + (attempt?.submittedAt !== undefined ? "done" : answer?.text.trim() ? "draft" : "")} aria-current={current ? "step" : undefined} aria-label={`Question ${label}${answer?.flagged ? ", flagged" : ""}`} onClick={() => onQuestion(i, part.label)}>{label}{answer?.flagged && <span className="session-flag-label">Flagged</span>}</button>;
    }))}</nav>
  </aside>;
}
