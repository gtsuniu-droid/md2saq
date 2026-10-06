import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { db, getSettings, newId } from "../data/db";
import type { Mark, Question } from "../data/types";
import MarkingQuestion from "../components/MarkingQuestion";
import QuickEdit from "../components/QuickEdit";
import AmbossText from "../components/AmbossText";
import CommentedAnswer from "../components/CommentedAnswer";
import { belongsToAccount } from "../lib/progressAccount";
import { setAttemptReview } from "../lib/setAttemptReview";
import { introducedStems, markingDraft, reconcileMarkingParts, type MarkingDraft } from "../lib/markingSet";
import { saveSetMarking } from "../lib/saveMarking";
import { setLabel } from "../lib/sets";
import { formatDuration, stemsOf } from "../lib/questions";
import { isAdmin } from "../lib/admin";
import { loadSession, saveSession } from "../lib/session";
import { sessionAtQuestion } from "../lib/sessionNavigation";
import { questionRef, requestSync } from "../lib/sync";
import { clearMarkingDraft, loadMarkingDraft, writeMarkingDraft } from "../lib/markingDrafts";

export default function MarkPage() {
  const { attemptId = "" } = useParams();
  return <SetMarking attemptId={attemptId} />;
}

function SetMarking({ attemptId }: { attemptId: string }) {
  const nav = useNavigate();
  const [drafts, setDrafts] = useState<Record<string, MarkingDraft>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const fallbackIds = useRef<string[]>([]);
  const previousRoute = useRef(attemptId);
  if (previousRoute.current !== attemptId) { previousRoute.current = attemptId; fallbackIds.current = []; }
  const [message, setMessage] = useState("");
  const [draftWarning, setDraftWarning] = useState("");
  const [editing, setEditing] = useState<Question | null>(null);
  const liveData = useLiveQuery(async () => {
    const settings = await getSettings();
    const ownerId = settings.cloudUser?.uid ?? "";
    const [allAttempts, questions, allMarks] = await Promise.all([db.attempts.toArray(), db.questions.toArray(), db.marks.toArray()]);
    const attempts = allAttempts.filter((a) => belongsToAccount(a, ownerId));
    const marks = allMarks.filter((m) => belongsToAccount(m, ownerId));
    const anchorId = attempts.some((a) => a.id === attemptId) ? attemptId : fallbackIds.current.find((id) => attempts.some((a) => a.id === id));
    const review = anchorId ? setAttemptReview(anchorId, attempts, questions, marks, ownerId) : null;
    if (!review) return null;
    const set = review.setId ? await db.sets.get(review.setId) : undefined;
    const examLocked = review.anchor.mode === "exam" && attempts.some((a) => (review.anchor.sessionId ? a.sessionId === review.anchor.sessionId : a.id === attemptId) && a.submittedAt === undefined);
    const session = loadSession(ownerId);
    const inSession = session?.id === review.anchor.sessionId ? session : null;
    const lastIndex = inSession ? Math.max(...review.rows.flatMap((r) => r.attempt ? [inSession.attemptIds.indexOf(r.attempt.id)] : [])) : -1;
    const nextId = inSession && lastIndex >= 0 ? inSession.attemptIds[lastIndex + 1] : undefined;
    const nextAttempt = nextId ? attempts.find((a) => a.id === nextId) : undefined;
    return { ...review, set, attempts, marks, questions, admin: isAdmin(settings), ownerId, examLocked, inSession, nextAttempt };
  }, [attemptId]);
  // Keep the editor mounted if deleting its question removes the route's anchor.
  const lastData = useRef(liveData);
  if (liveData) lastData.current = liveData;
  const data = liveData ?? (editing ? lastData.current : liveData);

  useEffect(() => {
    if (!data) return;
    fallbackIds.current = data.rows.flatMap((r) => r.attempt ? [r.attempt.id] : []);
    setDrafts((current) => {
      const next: Record<string, MarkingDraft> = {};
      for (const { question, attempt, mark } of data.rows) {
        if (!question || !attempt || attempt.submittedAt === undefined) continue;
        const recovered = current[attempt.id] ?? loadMarkingDraft(data.ownerId, attempt.id, question.id, mark);
        next[attempt.id] = recovered ? reconcileMarkingParts(recovered, question) : markingDraft(question, attempt, mark);
      }
      return next;
    });
  }, [data]);

  if (data === undefined) return <p className="muted">Loading your set…</p>;
  if (!data) return <div><Link to="/#history">Back to history</Link><p>Attempt not found for this account.</p></div>;
  if (data.examLocked) return <div><h1>Submit the paper to begin marking</h1><Link to="/paper">Continue paper</Link></div>;
  const { anchor, rows, set, inSession } = data;
  const readyRows = rows.filter((r) => r.question && r.attempt?.submittedAt !== undefined);
  const ready = readyRows.length > 0 && readyRows.every((r) => drafts[r.attempt!.id]);
  const allParts = readyRows.flatMap((r) => drafts[r.attempt!.id]?.parts ?? []);
  const total = allParts.reduce((sum, p) => sum + p.score, 0);
  const maximum = allParts.reduce((sum, p) => sum + p.maxScore, 0);

  const save = async (advance: boolean) => {
    if (!ready || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setMessage("");
    try {
      const entries = await Promise.all(readyRows.map(async ({ question, attempt, mark }) => {
        const draft = drafts[attempt!.id];
        const value: Mark = {
          ...mark, id: mark?.id ?? newId(), attemptId: attempt!.id, ownerId: data.ownerId,
          questionId: question!.id, qref: mark?.qref ?? await questionRef(question!),
          score: 0, maxScore: 0, parts: draft.parts, errorTags: draft.errorTags,
          learningPoint: draft.learningPoint.trim() || undefined, notes: draft.notes.trim() || undefined,
          reviewLater: draft.reviewLater || draft.lookedAtAnswer, lookedAtAnswer: draft.lookedAtAnswer, markedAt: Date.now(),
        };
        return { mark: value, confidence: draft.confidence };
      }));
      await saveSetMarking(entries);
      for (const { attempt } of readyRows) clearMarkingDraft(data.ownerId, attempt!.id, drafts[attempt!.id]);
      setDraftWarning("");
      requestSync();
      if (!advance) { setMessage("Set saved"); return; }
      // Re-read the session: deleting or changing a question can update it while marking.
      const current = loadSession(data.ownerId);
      if (inSession && current?.id === inSession.id && data.nextAttempt) {
        if (data.nextAttempt.submittedAt !== undefined) nav(`/mark/${data.nextAttempt.id}`);
        else {
          saveSession(sessionAtQuestion(current, data.questions, current.attemptIds.indexOf(data.nextAttempt.id)));
          nav("/paper");
        }
      } else nav(inSession ? `/session/${inSession.id}` : `/history/${anchor.id}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save the set. Please try again."); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const deleted = () => {
    const replacement = rows.find((r) => r.attempt && r.question?.id !== editing?.id)?.attempt;
    setEditing(null);
    nav(replacement ? `/mark/${replacement.id}` : `/set/${data.setId}`, { replace: true });
  };

  return <div className="set-marking">
    <div className="mark-set-heading">
      <div><Link to={inSession ? `/session/${inSession.id}` : "/#history"}>{inSession ? "Session summary" : "History"}</Link>
        <h1>Mark set</h1><h2>{set ? setLabel(set) : anchor.qref?.setName || "Your set"}</h2>
        <p className="muted">{rows.length} questions, {formatDuration(rows.reduce((sum, r) => sum + (r.attempt?.elapsedSec ?? 0), 0))}, {anchor.mode === "exam" ? "Exam" : "Practice"}</p>
        <p className="muted">Your marking draft stays on this device. Save set to update your results.</p>
      </div>
    </div>
    {set?.markingNotes && <details className="card"><summary>Set marking notes</summary><p className="pre">{set.markingNotes}</p></details>}
    <fieldset className="mark-set-fields" disabled={saving}>
    {rows.map(({ question, attempt, mark, order }, index) => {
      const stems = question ? stemsOf(question) : [];
      const previousQuestion = rows[index - 1]?.question;
      const newStems = question ? introducedStems(question, previousQuestion) : [];
      const previous = question && attempt ? data.attempts.filter((a) => a.questionId === question.id && a.id !== attempt.id && a.submittedAt !== undefined && (a.submittedAt ?? 0) < (attempt.submittedAt ?? attempt.startedAt)).sort((a,b) => b.submittedAt! - a.submittedAt!)[0] : undefined;
      const previousMark = previous ? data.marks.filter((m) => m.attemptId === previous.id).sort((a,b) => b.markedAt - a.markedAt)[0] : undefined;
      const draft = attempt ? drafts[attempt.id] : undefined;
      return <div key={question?.id ?? attempt!.id}>
        {newStems.length > 0 && <section className="mark-set-stem" aria-label="Case stem">
          <h2>Case stem</h2>
          {newStems.map(({ text: stem, index: si }) => <AmbossText key={si} cacheKey={question!.id} texts={[...stems, question!.text]} text={stem} doc={question!.stemDocs?.[si]} highlights={rows.filter((r) => r.question && JSON.stringify(stemsOf(r.question)) === JSON.stringify(stems)).flatMap((r) => r.attempt?.stemHighlights ?? []).filter((h) => h.stem === si)} />)}
        </section>}
        {question && attempt?.submittedAt !== undefined && draft ? <MarkingQuestion question={question} attempt={attempt} set={set} draft={draft} previous={previous} previousMark={previousMark} admin={data.admin} onEdit={setEditing} onChange={(value) => {
          setDrafts((current) => ({ ...current, [attempt.id]: value }));
          setDraftWarning(writeMarkingDraft(data.ownerId, attempt.id, question.id, value, mark) ? "" : "Draft recovery is unavailable. Save set before leaving this page.");
          setMessage("");
        }} /> : <section className="card mark-question">
          <h2>Question {order + 1}</h2><AmbossText className="pre marking-prompt" cacheKey={question?.id ?? attempt!.id} texts={[question?.text ?? ""]} text={question?.text || attempt?.qref?.text || "Question no longer available"} doc={question?.textDoc} />
          <p className="muted">{!question ? "This question has been removed. Your saved answer is below." : attempt?.submittedAt !== undefined ? "Loading marking…" : attempt ? "Not submitted" : "Not attempted in this sitting"}</p>
          {attempt?.answers.map((a) => <CommentedAnswer key={a.label} attemptId={attempt.id} partLabel={a.label} doc={a.doc} text={a.text} comments={attempt.answerComments ?? []} />)}
          {mark && <p>Saved score {mark.score}/{mark.maxScore}</p>}
          {question && attempt && attempt.submittedAt === undefined && inSession?.attemptIds.includes(attempt.id) && inSession.questionIds.includes(question.id) && <Link to="/paper" onClick={() => saveSession(sessionAtQuestion(inSession, data.questions, inSession.questionIds.indexOf(question.id)))}>Continue set</Link>}
        </section>}
      </div>;
    })}
    </fieldset>
    {set?.debrief && <details className="card"><summary>Set debrief</summary><p className="pre">{set.debrief}</p></details>}
    <div className="mark-set-save" aria-label="Save set marking">
      <strong>Set total {total} / {maximum}</strong>
      <span style={{ flex: 1 }} />
      {message && <span role="status">{message}</span>}
      {draftWarning && <span role="alert">{draftWarning}</span>}
      <button disabled={saving || !ready} onClick={() => void save(false)}>{saving ? "Saving…" : "Save set"}</button>
      <button className="primary" disabled={saving || !ready} onClick={() => void save(true)}>{data.nextAttempt ? "Save and next set" : "Save and finish"}</button>
    </div>
    {editing && <QuickEdit question={editing} onClose={() => setEditing(null)} onDeleted={deleted} />}
  </div>;
}
