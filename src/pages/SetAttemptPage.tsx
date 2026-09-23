import { useLiveQuery } from "dexie-react-hooks";
import { Link, useParams } from "react-router";
import { db, getSettings } from "../data/db";
import CommentedAnswer from "../components/CommentedAnswer";
import { answerParts, formatDuration, partLabel, stemsOf } from "../lib/questions";
import { setAttemptReview } from "../lib/setAttemptReview";
import { setLabel } from "../lib/sets";

export default function SetAttemptPage() {
  const { attemptId = "" } = useParams();
  const data = useLiveQuery(async () => {
    const ownerId = (await getSettings()).cloudUser?.uid ?? "";
    const [attempts, questions, marks] = await Promise.all([db.attempts.toArray(), db.questions.toArray(), db.marks.toArray()]);
    const review = setAttemptReview(attemptId, attempts, questions, marks, ownerId);
    if (!review) return null;
    const set = review.setId ? await db.sets.get(review.setId) : undefined;
    return { ...review, set };
  }, [attemptId]);
  if (data === undefined) return <p className="muted">Loading your answers…</p>;
  if (!data) return <div><Link to="/#history">Back to history</Link><p>Attempt not found for this account.</p></div>;
  const { anchor, rows, set } = data;
  const title = set ? setLabel(set) : anchor.qref?.setName || "Set review";
  const date = new Date(anchor.submittedAt ?? anchor.startedAt).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const total = rows.reduce((sum, r) => sum + (r.mark?.score ?? 0), 0);
  const max = rows.reduce((sum, r) => sum + (r.mark?.maxScore ?? 0), 0);
  return <div className="set-attempt-review">
    <Link to="/#history">Back to history</Link>
    <h1>{title}</h1>
    {set?.name && set.name !== title && <p>{set.name}</p>}
    <p className="muted">{date}, {anchor.mode === "exam" ? "Exam" : "Practice"}, {formatDuration(rows.reduce((sum, r) => sum + (r.attempt?.elapsedSec ?? 0), 0))}{max > 0 ? `, ${total}/${max} marked` : ""}</p>
    <h2>Your answers</h2>
    {rows.map(({ question, attempt, mark, order }, i) => {
      const previous = rows[i - 1]?.question;
      const stems = question ? stemsOf(question) : [];
      const showStems = stems.length > 0 && (!previous || stems.join("\n") !== stemsOf(previous).join("\n"));
      const parts = question ? answerParts(question) : (attempt?.answers ?? []).map((a) => ({ label: a.label, text: "" }));
      const extraAnswers = (attempt?.answers ?? []).filter((a) => !parts.some((p) => p.label === a.label));
      return <section className="card set-attempt-question" key={question?.id ?? attempt!.id} aria-label={`Question ${order + 1}`}>
        {showStems && <div className="set-attempt-stem">{stems.map((stem, index) => <p className="pre" key={index}>{stem}</p>)}</div>}
        <div className="row spread"><h3>Question {order + 1}</h3><span className="muted">{mark ? `${mark.score}/${mark.maxScore}` : attempt?.submittedAt !== undefined ? "Needs marking" : attempt ? "Not submitted" : "Not attempted in this sitting"}</span></div>
        <p className="pre">{question?.text || attempt?.qref?.text || "Question no longer available."}</p>
        {(question?.images ?? []).map((im) => <figure className="qimg" key={im.id}><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption>{im.caption}</figcaption>}</figure>)}
        {[...parts, ...extraAnswers.map((a) => ({ label: a.label, text: "" }))].map((part) => {
          const answer = attempt?.answers.find((a) => a.label === part.label);
          return <div className="set-attempt-answer" key={part.label}>
            {(part.label || part.text) && <p className="pre">{part.label && <strong>{partLabel(part.label)} </strong>}{part.text}</p>}
            {attempt ? <CommentedAnswer key={`${attempt.id}:${part.label}`} attemptId={attempt.id} partLabel={part.label} doc={answer?.doc} text={answer?.text} comments={attempt.answerComments ?? []} /> : <p className="muted">No answer written.</p>}
          </div>;
        })}
        {!question && !parts.length && <p className="muted">No answer written.</p>}
        {mark?.lookedAtAnswer && <p className="review-later-label">Looked at the answer</p>}
        {mark?.reviewLater && <p className="review-later-label">⚑ Review later</p>}
        {mark?.notes && <div className="saved-mark-notes"><strong>My notes</strong><p className="pre">{mark.notes}</p></div>}
        {question && attempt?.submittedAt !== undefined && <Link to={`/mark/${attempt.id}`}>{mark ? "Review marking" : "Mark answer"}</Link>}
      </section>;
    })}
  </div>;
}
