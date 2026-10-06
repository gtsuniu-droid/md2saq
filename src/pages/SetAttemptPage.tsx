import AmbossText from "../components/AmbossText";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useParams } from "react-router";
import { db, getSettings } from "../data/db";
import CommentedAnswer from "../components/CommentedAnswer";
import { answerParts, formatDuration, partLabel } from "../lib/questions";
import { setAttemptReview } from "../lib/setAttemptReview";
import { introducedStems } from "../lib/markingSet";
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
    <div className="row spread attempt-summary"><time className="muted">{new Date(anchor.submittedAt ?? anchor.startedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</time>{max > 0 && <strong>{total}/{max}</strong>}</div>
    <details className="attempt-details"><summary>Attempt details</summary><dl><dt>Submitted</dt><dd>{date}</dd><dt>Mode</dt><dd>{anchor.mode === "exam" ? "Exam" : "Practice"}</dd><dt>Time spent</dt><dd>{formatDuration(rows.reduce((sum, r) => sum + (r.attempt?.elapsedSec ?? 0), 0))}</dd></dl></details>
    <div className="row spread"><h2>Your answers</h2>{rows.some((r) => r.question && r.attempt?.submittedAt !== undefined) && <Link to={`/mark/${anchor.id}`}>Mark whole set</Link>}</div>
    {rows.map(({ question, attempt, mark, order }, i) => {
      const previous = rows[i - 1]?.question;
      const stems = question ? introducedStems(question, previous) : [];
      const parts = question ? answerParts(question) : (attempt?.answers ?? []).map((a) => ({ label: a.label, text: "", textDoc: undefined }));
      const extraAnswers = (attempt?.answers ?? []).filter((a) => !parts.some((p) => p.label === a.label));
      return <section className="card set-attempt-question" key={question?.id ?? attempt!.id} aria-label={`Question ${order + 1}`}>
        {stems.length > 0 && <div className="set-attempt-stem">{stems.map(({ text, index }) => <AmbossText key={index} cacheKey={question!.id} texts={[text]} text={text} doc={question!.stemDocs?.[index]} />)}</div>}
        <div className="row spread"><h3>Question {order + 1}</h3><span className="muted">{mark ? `${mark.score}/${mark.maxScore}` : attempt?.submittedAt !== undefined ? "Needs marking" : attempt ? "Not submitted" : "Not attempted in this sitting"}</span></div>
        <AmbossText className="pre marking-prompt" cacheKey={question?.id ?? attempt!.id} texts={[question?.text ?? ""]} text={question?.text || attempt?.qref?.text || "Question no longer available."} doc={question?.textDoc} />
        {(question?.images ?? []).map((im) => <figure className="qimg" key={im.id}><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption>{im.caption}</figcaption>}</figure>)}
        {[...parts, ...extraAnswers.map((a) => ({ label: a.label, text: "", textDoc: undefined }))].map((part) => {
          const answer = attempt?.answers.find((a) => a.label === part.label);
          return <div className="set-attempt-answer" key={part.label}>
            {(part.label || part.text) && <div className="pre marking-prompt">{part.label && <strong>{partLabel(part.label)} </strong>}<AmbossText cacheKey={question?.id ?? attempt!.id} texts={[part.text]} text={part.text} doc={part.textDoc} /></div>}
            {attempt ? <CommentedAnswer key={`${attempt.id}:${part.label}`} attemptId={attempt.id} partLabel={part.label} doc={answer?.doc} text={answer?.text} comments={attempt.answerComments ?? []} /> : <p className="muted">No answer written.</p>}
          </div>;
        })}
        {!question && !parts.length && <p className="muted">No answer written.</p>}
        {mark?.lookedAtAnswer && <p className="review-later-label">Looked at the answer</p>}
        {mark?.reviewLater && <p className="review-later-label">⚑ Review later</p>}
        {mark?.notes && <div className="saved-mark-notes"><strong>My notes</strong><p className="pre">{mark.notes}</p></div>}
      </section>;
    })}
  </div>;
}
