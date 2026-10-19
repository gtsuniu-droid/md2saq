import QuestionCommunity from "../components/QuestionCommunity";
import ShareLinks from "../components/ShareLinks";
import ConfirmDialog from "../components/ConfirmDialog";
import { belongsToAccount } from "../lib/progressAccount";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router";
import { db, getSettings } from "../data/db";
import { isAdmin } from "../lib/admin";
import { deleteQuestion } from "../lib/deleteQuestion";
import { bankErrorMessage, pushToBank, savedPasscode } from "../lib/share";
import { useState } from "react";
import { ERROR_TAGS } from "../data/types";
import PresentationPicker from "../components/PresentationPicker";
import AnswerHtml from "../components/AnswerHtml";
import { answerParts, formatDate, formatDuration, partLabel, stemsOf } from "../lib/questions";
import { setLabel } from "../lib/sets";
import AmbossText from "../components/AmbossText";
import ModelAnswerContent from "../components/ModelAnswerContent";
import { hasModelAnswer, richAnswerDocument } from "../lib/modelAnswer";

export default function QuestionPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const data = useLiveQuery(async () => {
    const q = await db.questions.get(id);
    if (!q) return null;
    const set = await db.sets.get(q.setId);
    const ownerId = (await getSettings()).cloudUser?.uid ?? "";
    const attempts = (await db.attempts.where("questionId").equals(id).toArray())
      .filter((a) => belongsToAccount(a, ownerId) && a.submittedAt !== undefined)
      .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
    const marks = await db.marks.where("questionId").equals(id).filter((m) => belongsToAccount(m, ownerId)).toArray();
    return { q, set, attempts, marks: new Map(marks.map((m) => [m.attemptId, m])), admin: isAdmin(await getSettings()) };
  }, [id]);

  if (data === undefined) return null;
  if (data === null) return <p>Question not found.</p>;
  const { q, set, attempts, marks, admin } = data;
  const qTexts = [...stemsOf(q), q.text, ...q.parts.map((p) => p.text)];

  const remove = async () => {
    if (!isAdmin(await getSettings())) return;
    const setId = q.setId;
    setDeleteBusy(true);
    try {
      await deleteQuestion(id);
      let warning: string | undefined;
      if (await savedPasscode()) {
        try { await pushToBank(setId); }
        catch (e) { warning = `Deleted here, not published: ${bankErrorMessage(e)} Publish local changes in Settings to retry.`; }
      }
      nav(`/set/${setId}`, { state: { message: warning } });
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not delete this question."); setDeleting(false); }
    finally { setDeleteBusy(false); }
  };

  return (
    <div>
      <div className="row spread">
        <div className="muted"><Link to={`/set/${q.setId}`}>{set ? setLabel(set) : "Set"}</Link>, question {q.order + 1}</div>
        <QuestionCommunity key={`community-${q.id}`} question={q} set={set} />
        <ShareLinks key={q.id} set={set} />
        {admin && <button className="danger small" onClick={() => setDeleting(true)}>Delete question</button>}
      </div>
      {message && <p style={{ color: "var(--warn)" }}>{message}</p>}
      <div className="card" style={{ marginTop: "0.8rem" }}>
        {stemsOf(q).map((st, si) => (
          <div key={si} className="stem-block">
            {stemsOf(q).length > 1 && <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.2rem" }}>Stage {si + 1}</div>}
            <AmbossText cacheKey={q.id} texts={qTexts} text={st} doc={q.stemDocs?.[si]} />
          </div>
        ))}
        {(q.images ?? []).map((im) => (
          <figure key={im.id} className="qimg"><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption className="muted">{im.caption}</figcaption>}</figure>
        ))}
        <AmbossText cacheKey={q.id} texts={qTexts} text={q.text} doc={q.textDoc} />
        {q.parts.map((p) => (
          <div key={p.label} className="part-head" style={{ marginTop: "0.6rem" }}>
            <span className="label">{partLabel(p.label)}</span>
            <AmbossText cacheKey={q.id} texts={qTexts} text={p.text} doc={p.textDoc} className="text" />
            {p.marks !== undefined && <span className="marks">({p.marks})</span>}
          </div>
        ))}
        {q.parts.length === 0 && q.marks !== undefined && <div className="muted" style={{ marginTop: "0.5rem" }}>{q.marks} marks</div>}
      </div>
      <label>Presentations</label>
      <PresentationPicker selected={q.presentations} onChange={(ids) => db.questions.update(q.id, { presentations: ids })} />

      {(hasModelAnswer(q) || q.parts.some(hasModelAnswer)) && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer" }}>Model answer</summary>
          <div className="card stack" style={{ marginTop: "0.5rem" }}>
            {q.parts.filter(hasModelAnswer).map((p) => (
              <div key={p.label}><strong>{partLabel(p.label)}</strong><ModelAnswerContent answer={p} /></div>
            ))}
            {hasModelAnswer(q) && (richAnswerDocument(q) || !q.parts.some(hasModelAnswer)) && <ModelAnswerContent answer={q} />}
          </div>
        </details>
      )}

      <ConfirmDialog open={deleting} title={`Delete question ${q.order + 1}?`} confirmLabel="Delete question" destructive busy={deleteBusy} onCancel={() => setDeleting(false)} onConfirm={() => void remove()}>
        <p>The question, its subquestions and {attempts.length ? `its ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}` : "any attempts"} on this device are removed. The other questions in the set stay, renumbered.{set?.bankId ? " The shared library updates for everyone." : ""}</p>
      </ConfirmDialog>

      <h2>Attempts</h2>
      {attempts.length === 0 && <p className="muted">Not attempted yet.</p>}
      <div className="two-col">
        {attempts.map((a, i) => {
          const m = marks.get(a.id);
          return (
            <div key={a.id} className="card">
              <div className="row spread">
                <strong>Attempt {i + 1}</strong>
                <span className="muted">{formatDate(a.submittedAt!)}, {formatDuration(a.elapsedSec)}, {a.mode}</span>
              </div>
              <div>
                {m ? (
                  <span>{m.score}/{m.maxScore}{m.errorTags.length ? ", " + m.errorTags.map((t) => ERROR_TAGS.find((e) => e.id === t)?.label).join(", ") : ""}</span>
                ) : (
                  <Link to={`/mark/${a.id}`}>Mark this attempt</Link>
                )}
                {m && <>, <Link to={`/mark/${a.id}`}>edit mark</Link></>}
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
