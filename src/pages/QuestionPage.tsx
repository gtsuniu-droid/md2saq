import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router";
import { db } from "../data/db";
import { ERROR_TAGS } from "../data/types";
import PresentationPicker from "../components/PresentationPicker";
import AnswerHtml from "../components/AnswerHtml";
import { answerParts, formatDate, formatDuration, partLabel, totalMarks } from "../lib/questions";
import { startSession } from "../lib/session";

export default function QuestionPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const q = await db.questions.get(id);
    if (!q) return null;
    const set = await db.sets.get(q.setId);
    const attempts = (await db.attempts.where("questionId").equals(id).toArray())
      .filter((a) => a.submittedAt !== undefined)
      .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
    const marks = await db.marks.where("questionId").equals(id).toArray();
    return { q, set, attempts, marks: new Map(marks.map((m) => [m.attemptId, m])) };
  }, [id]);

  if (data === undefined) return null;
  if (data === null) return <p>Question not found.</p>;
  const { q, set, attempts, marks } = data;

  const remove = async () => {
    if (!confirm("Delete this question and its attempts?")) return;
    await db.transaction("rw", db.questions, db.attempts, db.marks, async () => {
      await db.marks.where("questionId").equals(id).delete();
      await db.attempts.where("questionId").equals(id).delete();
      await db.questions.delete(id);
    });
    nav("/library");
  };

  const practise = () => {
    startSession([q.id], "practice", (totalMarks(q) ?? 4) * 90);
    nav("/paper");
  };

  return (
    <div>
      <div className="row spread">
        <div className="muted"><Link to={`/library?set=${q.setId}`}>{set?.name}</Link> · Q{q.order + 1}</div>
        <div className="row">
          <button className="primary" onClick={practise}>Practise</button>
          <button className="danger small" onClick={remove}>Delete</button>
        </div>
      </div>
      <div className="card" style={{ marginTop: "0.8rem" }}>
        <div className="pre">{q.text}</div>
        {q.parts.map((p) => (
          <div key={p.label} className="part-head" style={{ marginTop: "0.6rem" }}>
            <span className="label">{partLabel(p.label)}</span>
            <span className="text">{p.text}</span>
            {p.marks !== undefined && <span className="marks">({p.marks})</span>}
          </div>
        ))}
        {q.parts.length === 0 && q.marks !== undefined && <div className="muted" style={{ marginTop: "0.5rem" }}>{q.marks} marks</div>}
      </div>
      <label>Presentations</label>
      <PresentationPicker selected={q.presentations} onChange={(ids) => db.questions.update(q.id, { presentations: ids })} />

      {(q.modelAnswer || q.parts.some((p) => p.modelAnswer)) && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer" }}>Model answer</summary>
          <div className="card stack" style={{ marginTop: "0.5rem" }}>
            {q.parts.filter((p) => p.modelAnswer).map((p) => (
              <div key={p.label}><strong>{partLabel(p.label)}</strong><div className="pre">{p.modelAnswer}</div></div>
            ))}
            {q.modelAnswer && !q.parts.some((p) => p.modelAnswer) && <div className="pre">{q.modelAnswer}</div>}
          </div>
        </details>
      )}

      <h2>Attempts</h2>
      {attempts.length === 0 && <p className="muted">Not attempted yet.</p>}
      <div className="two-col">
        {attempts.map((a, i) => {
          const m = marks.get(a.id);
          return (
            <div key={a.id} className="card">
              <div className="row spread">
                <strong>Attempt {i + 1}</strong>
                <span className="muted">{formatDate(a.submittedAt!)} · {formatDuration(a.elapsedSec)} · {a.mode}</span>
              </div>
              <div>
                {m ? (
                  <span>{m.score}/{m.maxScore}{m.errorTags.length ? " · " + m.errorTags.map((t) => ERROR_TAGS.find((e) => e.id === t)?.label).join(", ") : ""}</span>
                ) : (
                  <Link to={`/mark/${a.id}`}>Mark this attempt</Link>
                )}
                {m && <> · <Link to={`/mark/${a.id}`}>edit mark</Link></>}
              </div>
              {answerParts(q).map((p) => {
                const ans = a.answers.find((x) => x.label === p.label);
                return (
                  <div key={p.label} style={{ marginTop: "0.5rem" }}>
                    {p.label && <strong>{partLabel(p.label)}</strong>}
                    <AnswerHtml doc={ans?.doc} />
                  </div>
                );
              })}
              {m?.learningPoint && <p><strong>Learning point:</strong> {m.learningPoint}</p>}
              {m?.reflection && <p className="muted">{m.reflection}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
