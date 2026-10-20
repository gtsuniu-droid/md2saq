import ShareLinks from "../components/ShareLinks";
import SetCode from "../components/SetCode";
import ConfirmDialog from "../components/ConfirmDialog";
import AccountGate from "../components/AccountGate";
import { useAccountGate } from "../lib/accountGate";
import { primaryPresentation } from "../lib/primaryPresentation";
import { belongsToAccount } from "../lib/progressAccount";
import { useLiveQuery } from "dexie-react-hooks";
import { loadSession } from "../lib/session";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { db, getSettings } from "../data/db";
import { presentationName } from "../data/presentations";
import { formatDate, formatDuration, partLabel, totalMarks, truncate } from "../lib/questions";
import { loadSummaries, setLabel, setTitle, startSet, suggestedMinutesFor } from "../lib/sets";
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
  const [replacing, setReplacing] = useState<"practice" | "exam" | null>(null);
  const gate = useAccountGate();
  const [gateOpen, setGateOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const summaries = await loadSummaries();
    const summary = summaries.find((s) => s.set.id === id) ?? null;
    if (!summary) return null;
    const settings = await getSettings();
    const marks = await db.marks.where("questionId").anyOf(summary.questions.map((q) => q.id)).filter((m) => belongsToAccount(m, settings.cloudUser?.uid ?? "")).toArray();
    const attempts = await db.attempts.where("questionId").anyOf(summary.questions.map((q) => q.id)).filter((a) => belongsToAccount(a, settings.cloudUser?.uid ?? "")).toArray();
    const lastByQuestion = new Map<string, { score: number; max: number }>();
    for (const m of [...marks].sort((a, b) => a.markedAt - b.markedAt)) lastByQuestion.set(m.questionId, { score: m.score, max: m.maxScore });
    const doneByQuestion = new Map<string, number>();
    for (const a of attempts) if (a.submittedAt) doneByQuestion.set(a.questionId, (doneByQuestion.get(a.questionId) ?? 0) + 1);
    return { summary, settings, lastByQuestion, doneByQuestion, attempts: attempts.length, admin: isAdmin(settings), unlocked: !!settings.bankPasscode && isAdmin(settings) };
  }, [id]);

  if (data === undefined) return null;
  if (data === null) return <p>Set not found.</p>;
  const { summary, settings, lastByQuestion, doneByQuestion, admin, unlocked } = data;
  const { set, questions, sittings } = summary;
  const suggested = suggestedMinutesFor(summary, settings.minutesPerMark);
  const presentation = primaryPresentation(set, questions);

  const begin = (mode: "practice" | "exam") => {
    const mins = minutes.trim() === "" ? suggested : Number(minutes);
    startSet(summary, mode, mins);
    nav("/paper");
  };
  const start = (mode: "practice" | "exam") => {
    if (gate.gated) { setGateOpen(true); return; }
    if (loadSession()) { setReplacing(mode); return; }
    begin(mode);
  };

  const move = async (presentationId: string) => {
    if (!presentationId || presentationId === presentation) return;
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
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteSetEverywhere(set.id);
      nav("/browse", { state: { message: `Deleted ${setLabel(set)}.` } });
    } catch (e) {
      setDeleteError(`Not deleted: ${bankErrorMessage(e)}`);
      setDeleteBusy(false);
    }
  };

  const canDelete = admin && (!set.bankId || unlocked);
  const meta = [
    `${questions.length} question${questions.length === 1 ? "" : "s"}`,
    summary.marks ? `${summary.marks} marks` : "",
    presentation ? presentationName(presentation) : "",
    setTitle(set),
  ].filter(Boolean);

  return (
    <div>
      <header className="set-page-head">
        <div className="set-crumbs"><Link to="/browse">Browse</Link>{set.collection ? <>, <Link to={`/browse?collection=${encodeURIComponent(set.collection)}`}>{set.collection}</Link></> : null}</div>
        <h1>{fullLabel(summary)}</h1>
        <p className="set-meta">{meta.map((m) => <span key={m}>{m}</span>)}{set.bankId && <SetCode bankId={set.bankId} />}</p>
        {set.tags && set.tags.length > 0 && (
          <div className="set-tags">{set.tags.map((t) => <Link key={t} to={`/browse?tag=${encodeURIComponent(t)}`}>{t}</Link>)}</div>
        )}
        {flash && <p className={`set-flash${flash.startsWith("Saved and") ? "" : " warn"}`} role="status">{flash}</p>}
      </header>
      {set.instructions && (
        <details className="muted" style={{ marginTop: "0.4rem" }}>
          <summary style={{ cursor: "pointer" }}>Instructions</summary>
          <div className="pre" style={{ marginTop: "0.3rem" }}>{set.instructions}</div>
        </details>
      )}

      <div className="set-actions">
        <button className="primary" onClick={() => start("practice")}>{sittings.length ? "Practise again" : "Practise this set"}</button>
        <button onClick={() => start("exam")}>Sit as exam</button>
        <label className="timer">Time<input aria-label="Practice time in minutes" type="number" min={0} placeholder={String(suggested)} value={minutes} onChange={(e) => setMinutes(e.target.value)} />min</label>
        <span className="spacer" />
        <ShareLinks key={set.id} set={set} />
      </div>
      <p className="set-actions-hint">Leave the time blank for the suggested {suggested} minutes{set.suggestedMinutes ? ", as the paper states" : ""}; 0 means no timer. Practice lets you mark as you go; an exam reveals nothing until the paper is submitted.</p>

      {admin && (
        <div className="card set-manage">
          <span className="label">Manage</span>
          {unlocked ? (
            <>
              <label className="set-move">Presentation<PresentationSelect value={presentation ?? ""} onChange={move} disabled={moving} placeholder="None" title="Move this set to a presentation. It takes the next number there." /></label>
              <Link className="button small" to={`/set/${set.id}/edit#case-stems`}>Edit questions</Link>
            </>
          ) : (
            <span className="muted">Unlock on the <Link to="/admin">Admin page</Link> to edit or move this set.</span>
          )}
          <span className="spacer" />
          {canDelete && <button className="small danger" onClick={() => { setDeleteError(null); setDeleting(true); }}>Delete set</button>}
          {moveMessage && <p className={`set-manage-note${moveMessage.includes("not published") ? " field-error" : " muted"}`} role="status">{moveMessage}</p>}
        </div>
      )}

      <h2>Questions</h2>
      <table className="set-questions">
        <tbody>
          {questions.map((q) => {
            const lm = lastByQuestion.get(q.id);
            return (
              <tr key={q.id}>
                <td style={{ width: "2.5rem" }}>{q.order + 1}</td>
                <td>
                  <Link to={`/question/${q.id}`}>{truncate(q.text || q.parts[0]?.text || "", 140)}</Link>
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

      <AccountGate open={gateOpen} guestSubmitted={gate.guestSubmitted} onClose={() => setGateOpen(false)} />
      <ConfirmDialog open={replacing !== null} title="Replace your unfinished session?" confirmLabel="Start new session" onCancel={() => setReplacing(null)} onConfirm={() => { const mode = replacing!; setReplacing(null); begin(mode); }}>
        <p>You have a paper in progress. Starting this set replaces it. Answers you already submitted are kept; unsubmitted drafts are discarded.</p>
      </ConfirmDialog>

      <ConfirmDialog open={deleting} title={`Delete ${setLabel(set)}?`} confirmLabel="Delete set" destructive busy={deleteBusy} error={deleteError} onCancel={() => setDeleting(false)} onConfirm={() => void remove()}>
        <p>This removes:</p>
        <ul>
          <li><strong>{questions.length} question{questions.length === 1 ? "" : "s"}</strong>{set.name && set.name !== setLabel(set) ? ` from ${set.name}` : ""}</li>
          {data.attempts > 0 && <li><strong>{data.attempts} attempt{data.attempts === 1 ? "" : "s"}</strong> and their marks on this device</li>}
          {set.bankId && <li>The set from the <strong>shared library, for everyone</strong>. It will not come back on the next sync.</li>}
        </ul>
        <p>This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
