import { useLiveQuery } from "dexie-react-hooks";
import { loadSession } from "../lib/session";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { db, getSettings } from "../data/db";
import { presentationName } from "../data/presentations";
import { formatDate, formatDuration, partLabel, totalMarks, truncate } from "../lib/questions";
import { loadSummaries, setLabel, startSet, suggestedMinutesFor } from "../lib/sets";
import { fullLabel } from "../lib/tree";
import { isAdmin } from "../lib/admin";
import { moveSetToPresentation } from "../lib/movePresentation";
import { bankErrorMessage, deleteSetEverywhere, pushToBank, savedPasscode } from "../lib/share";
import PresentationSelect from "../components/PresentationSelect";

export default function SetPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const [minutes, setMinutes] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveMessage, setMoveMessage] = useState<string | null>(null);
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
    return { summary, settings, lastByQuestion, doneByQuestion, unlocked: !!settings.bankPasscode && isAdmin(settings) };
  }, [id]);

  if (data === undefined) return null;
  if (data === null) return <p>Set not found.</p>;
  const { summary, settings, lastByQuestion, doneByQuestion, unlocked } = data;
  const { set, questions, sittings } = summary;
  const suggested = suggestedMinutesFor(summary, settings.minutesPerMark);

  const start = (mode: "practice" | "exam") => {
    if (loadSession() && !confirm("Start a new session and replace your unfinished paper? Submitted answers will be kept.")) return;
    const mins = minutes.trim() === "" ? suggested : Number(minutes);
    startSet(summary, mode, mins);
    nav("/paper");
  };

  const move = async (presentationId: string) => {
    if (!presentationId || presentationId === summary.presentations[0]) return;
    setMoving(true);
    setMoveMessage(null);
    try {
      await moveSetToPresentation(set.id, presentationId);
      if (await savedPasscode()) {
        try {
          await pushToBank(set.id);
          setMoveMessage(`Moved to ${presentationName(presentationId)} and published.`);
        } catch (e) {
          setMoveMessage(`Moved here, not published: ${bankErrorMessage(e)}`);
        }
      } else {
        setMoveMessage(`Moved to ${presentationName(presentationId)}.`);
      }
    } catch (e) {
      setMoveMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving(false);
    }
  };

  const remove = async () => {
    const everyone = !!set.bankId && unlocked;
    if (!confirm(`Delete ${setLabel(set)}${everyone ? " for everyone" : ""}, with its ${questions.length} questions and every attempt on this device?`)) return;
    try {
      await deleteSetEverywhere(set.id);
      nav("/browse");
    } catch (e) {
      setMoveMessage(`Not deleted: ${bankErrorMessage(e)}`);
    }
  };

  return (
    <div>
      <div className="muted"><Link to="/browse">Browse</Link>{set.collection ? <>, <Link to={`/browse?collection=${encodeURIComponent(set.collection)}`}>{set.collection}</Link></> : null}</div>
      <h1 style={{ marginTop: "0.3rem" }}>{fullLabel(summary)}</h1>
      {flash && <p style={{ color: flash.startsWith("Saved and") ? "var(--ok)" : "var(--warn)" }}>{flash}</p>}
      <p className="muted" style={{ marginTop: "-0.8rem" }}>
        {[
          `${questions.length} question${questions.length === 1 ? "" : "s"}`,
          summary.marks ? `${summary.marks} marks` : "",
          summary.presentations.map(presentationName).join(", "),
          set.number !== undefined && set.name && set.name !== setLabel(set) && !/^set\s*\d+$/i.test(set.name) ? set.name : "",
          set.source ?? "",
        ].filter(Boolean).join(", ")}
      </p>
      {unlocked && (
        <p className="row" style={{ marginTop: "-0.4rem" }}>
          <label style={{ margin: 0 }}>Presentation</label>
          <PresentationSelect value={summary.presentations[0] ?? ""} onChange={move} disabled={moving} placeholder="None" title="Move this set to a presentation. It takes the next number there." />
          {moveMessage && <span className={moveMessage.includes("not published") ? "" : "muted"} style={moveMessage.includes("not published") ? { color: "var(--warn)" } : undefined}>{moveMessage}</span>}
        </p>
      )}
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
        {unlocked && <Link to={`/set/${set.id}/edit`}><button className="small">Edit</button></Link>}
        {(!set.bankId || unlocked) && <button className="small danger" onClick={remove} title={set.bankId ? "Removes the set from the library for everyone" : undefined}>Delete</button>}
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
