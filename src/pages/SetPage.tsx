import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { db, getSettings } from "../data/db";
import { presentationName } from "../data/presentations";
import ShareSetButton from "../components/ShareSetButton";
import { formatDate, formatDuration, partLabel, totalMarks, truncate } from "../lib/questions";
import { loadSummaries, startSet, suggestedMinutesFor } from "../lib/sets";

export default function SetPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [minutes, setMinutes] = useState("");
  const data = useLiveQuery(async () => {
    const summaries = await loadSummaries();
    const summary = summaries.find((s) => s.set.id === id) ?? null;
    if (!summary) return null;
    const settings = await getSettings();
    const marks = await db.marks.where("questionId").anyOf(summary.questions.map((q) => q.id)).toArray();
    const attempts = await db.attempts.where("questionId").anyOf(summary.questions.map((q) => q.id)).toArray();
    const lastByQuestion = new Map<string, { score: number; max: number }>();
    for (const m of [...marks].sort((a, b) => a.markedAt - b.markedAt)) lastByQuestion.set(m.questionId, { score: m.score, max: m.maxScore });
    const doneByQuestion = new Map<string, number>();
    for (const a of attempts) if (a.submittedAt) doneByQuestion.set(a.questionId, (doneByQuestion.get(a.questionId) ?? 0) + 1);
    return { summary, settings, lastByQuestion, doneByQuestion, unlocked: !!settings.bankPasscode };
  }, [id]);

  if (data === undefined) return null;
  if (data === null) return <p>Set not found.</p>;
  const { summary, settings, lastByQuestion, doneByQuestion, unlocked } = data;
  const { set, questions, sittings } = summary;
  const suggested = suggestedMinutesFor(summary, settings.minutesPerMark);

  const start = (mode: "practice" | "exam") => {
    const mins = minutes.trim() === "" ? suggested : Number(minutes);
    startSet(summary, mode, mins);
    nav("/paper");
  };

  const remove = async () => {
    if (!confirm(`Delete "${set.name}" with its ${questions.length} questions and every attempt?`)) return;
    const qids = questions.map((q) => q.id);
    await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
      await db.marks.where("questionId").anyOf(qids).delete();
      await db.attempts.where("questionId").anyOf(qids).delete();
      await db.questions.bulkDelete(qids);
      await db.sets.delete(set.id);
    });
    nav("/browse");
  };

  return (
    <div>
      <div className="muted"><Link to="/browse">Browse</Link>{set.collection ? <>, <Link to={`/browse?collection=${encodeURIComponent(set.collection)}`}>{set.collection}</Link></> : null}</div>
      <h1 style={{ marginTop: "0.3rem" }}>{set.name}</h1>
      <p className="muted" style={{ marginTop: "-0.8rem" }}>
        {[
          `${questions.length} question${questions.length === 1 ? "" : "s"}`,
          summary.marks ? `${summary.marks} marks` : "",
          summary.presentations.map(presentationName).join(", "),
          set.source ?? "",
        ].filter(Boolean).join(", ")}
      </p>
      {set.tags && set.tags.length > 0 && (
        <p className="muted" style={{ marginTop: "-0.4rem" }}>
          {set.tags.map((t, i) => <span key={t}>{i > 0 ? ", " : ""}<Link to={`/browse?tag=${encodeURIComponent(t)}`}>{t}</Link></span>)}
        </p>
      )}
      {set.instructions && (
        <details className="muted" style={{ marginTop: "0.4rem" }}>
          <summary style={{ cursor: "pointer" }}>Instructions</summary>
          <div className="pre" style={{ marginTop: "0.3rem" }}>{set.instructions}</div>
        </details>
      )}

      <div className="card row" style={{ margin: "1.2rem 0" }}>
        <button className="primary" onClick={() => start("practice")}>Practice</button>
        <button onClick={() => start("exam")}>Exam</button>
        <input type="number" min={0} placeholder={String(suggested)} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <span className="muted">min{set.suggestedMinutes ? ", as the paper suggests" : ""}. 0 for no timer.</span>
        <span style={{ flex: 1 }} />
        {unlocked && <ShareSetButton setId={set.id} className="small" />}
        {unlocked && <Link to={`/set/${set.id}/edit`}><button className="small">Edit</button></Link>}
        <button className="small danger" onClick={remove}>Delete</button>
      </div>
      <p className="muted">Practice marks each question as you go. Exam reveals nothing until the whole paper is submitted.</p>

      <h2>Questions</h2>
      <table>
        <tbody>
          {questions.map((q) => {
            const lm = lastByQuestion.get(q.id);
            return (
              <tr key={q.id} className="clickable" onClick={() => nav(`/question/${q.id}`)}>
                <td style={{ width: "2.5rem" }} className="muted">{q.order + 1}</td>
                <td>
                  {truncate(q.text || q.parts[0]?.text || "", 140)}
                  {(q.parts.length > 0 || q.stems?.length) && (
                    <div className="muted">
                      {[q.stems?.length ? `${q.stems.length} stem${q.stems.length === 1 ? "" : "s"}` : "", q.parts.length ? q.parts.map((p) => partLabel(p.label)).join(" ") : ""].filter(Boolean).join(", ")}
                    </div>
                  )}
                </td>
                <td style={{ width: "4rem" }}>{totalMarks(q) ?? "—"}</td>
                <td style={{ width: "8rem" }} className="muted">{lm ? `${lm.score}/${lm.max}` : doneByQuestion.get(q.id) ? "unmarked" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {sittings.length > 0 && (
        <>
          <h2>Sittings</h2>
          <table>
            <tbody>
              {sittings.map((s) => (
                <tr key={s.sessionId}>
                  <td>{formatDate(s.submittedAt)}</td>
                  <td className="muted">{s.mode}</td>
                  <td className="muted">{formatDuration(Math.max(0, (s.submittedAt - s.startedAt) / 1000))}</td>
                  <td>{s.answered} of {questions.length} answered, {s.marked} marked</td>
                  <td>
                    {s.maxScore > 0 ? `${s.score}/${s.maxScore}` : ""}{" "}
                    <Link to={`/session/${s.sessionId}`}>{s.marked < s.answered ? "mark" : "review"}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
