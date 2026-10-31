import { belongsToAccount } from "../lib/progressAccount";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router";
import { db, getSettings } from "../data/db";
import { formatDuration, truncate } from "../lib/questions";
import { loadSession, saveSession } from "../lib/session";
import { setLabel } from "../lib/sets";
import { stemsOf } from "../lib/questions";
import { sessionAtQuestion } from "../lib/sessionNavigation";
import { studyRecords } from "../lib/study";
import { isAdmin } from "../lib/admin";
import ExamMarking from "../components/ExamMarking";
import { buildExamForMarking, examKey, examSets } from "../lib/examMarking";

export default function SessionReviewPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const live = useLiveQuery(async () => {
    const settings = await getSettings();
    const ownerId = settings.cloudUser?.uid ?? "";
    const attempts = (await db.attempts.where("sessionId").equals(id).toArray()).filter((a) => belongsToAccount(a, ownerId));
    const questions = await db.questions.bulkGet(attempts.map((a) => a.questionId));
    const marks = await db.marks.where("attemptId").anyOf(attempts.map((a) => a.id)).filter((m) => belongsToAccount(m, ownerId)).toArray();
    const byAttempt = new Map(marks.map((m) => [m.attemptId, m]));
    const sets = await db.sets.toArray();
    return { rows: attempts.map((a, i) => ({ a, q: questions[i], m: byAttempt.get(a.id), set: sets.find((s) => s.id === questions[i]?.setId) })), sets, admin: isAdmin(settings), ownerId };
  }, [id]);

  const study = useLiveQuery(async () => (await studyRecords()).find((r) => r.sessionId === id) ?? null, [id]);
  if (!live) return null;
  const { rows: data, sets, admin, ownerId } = live;
  const session = loadSession();
  const ordered = session?.id === id ? [...data].sort((x, y) => session.attemptIds.indexOf(x.a.id) - session.attemptIds.indexOf(y.a.id)) : data;
  const groups = Array.from(new Set(ordered.map((r) => r.q?.setId ?? r.a.qref?.setId ?? r.a.id))).map((setId) => ({
    setId, rows: ordered.filter((r) => (r.q?.setId ?? r.a.qref?.setId ?? r.a.id) === setId),
  }));
  const examLocked = ordered.some((r) => r.a.mode === "exam" && r.a.submittedAt === undefined);
  const unmarked = ordered.filter((r) => r.a.submittedAt !== undefined && !r.m);
  const unfinished = ordered.filter((r) => r.a.submittedAt === undefined);
  const total = ordered.reduce((acc, r) => acc + (r.m?.score ?? 0), 0);
  const max = ordered.reduce((acc, r) => acc + (r.m?.maxScore ?? 0), 0);
  // A submitted exam of several sets can be copied, or handed to an assistant, as one paper.
  const exam = !unfinished.length && groups.length > 1 && ordered.every((r) => r.a.mode === "exam")
    ? buildExamForMarking(examKey(id), examSets(ordered.map((r) => r.a), ordered.flatMap((r) => r.q ? [r.q] : []), sets, session?.id === id ? session.attemptIds : undefined)) : null;

  const finish = () => {
    if (session?.id === id && !unfinished.length) saveSession(null);
    nav("/home");
  };
  const resume = (questionId: string) => {
    if (!session || session.id !== id) return;
    saveSession(sessionAtQuestion(session, ordered.flatMap((r) => r.q ? [r.q] : []), session.questionIds.indexOf(questionId)));
    nav("/paper");
  };

  return (
    <div>
      <h1>{unfinished.length ? "Session in progress" : unmarked.length === 0 ? "Session complete" : "Paper submitted"}</h1>
      <p className="muted">{groups.length} sets, {ordered.length} questions, {formatDuration(ordered.reduce((acc, r) => acc + r.a.elapsedSec, 0))}, {unmarked.length} left to mark{unfinished.length ? `, ${unfinished.length} still to submit` : ""}{max > 0 ? `, ${total}/${max} so far` : ""}</p>
      <table>
        <thead><tr><th>#</th><th>Set</th><th>Time</th><th>Mark</th></tr></thead>
        <tbody>
          {groups.map((group, i) => {
            const first = group.rows[0];
            const submitted = group.rows.filter((r) => r.a.submittedAt !== undefined);
            const toMark = submitted.find((r) => !r.m) ?? submitted[0];
            const unfinished = group.rows.find((r) => r.a.submittedAt === undefined);
            const score = group.rows.reduce((sum, r) => sum + (r.m?.score ?? 0), 0);
            const maximum = group.rows.reduce((sum, r) => sum + (r.m?.maxScore ?? 0), 0);
            return <tr key={group.setId}>
              <td>{i + 1}</td>
              <td><strong>{first.set ? setLabel(first.set) : first.a.qref?.setName || "Set"}</strong>
                <div className="muted">{first.q ? truncate(stemsOf(first.q)[0] || first.q.text, 140) : "Question removed"}</div>
                {group.rows.some((r) => r.m?.reviewLater) && <span className="review-later-label">⚑ Review later</span>}
              </td>
              <td>{formatDuration(group.rows.reduce((sum, r) => sum + r.a.elapsedSec, 0))}</td>
              <td><div className="row">
                {maximum > 0 && <span>{score}/{maximum}</span>}
                {toMark && !examLocked && (session?.id === id ? <button className="small link" onClick={() => resume(toMark.a.questionId)}>{submitted.every((r) => r.m) ? "Review set" : "Mark set"}</button> : <Link to={`/mark/${toMark.a.id}`}>{submitted.every((r) => r.m) ? "Review set" : "Mark set"}</Link>)}
                {unfinished && session?.id === id && <button className="small" onClick={() => resume(unfinished.a.questionId)}>Continue set</button>}
              </div></td>
            </tr>;
          })}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: "1rem" }}>
        {unmarked.length > 0 && !examLocked && <button className="primary" onClick={() => session?.id === id ? resume(unmarked[0].a.questionId) : nav(`/mark/${unmarked[0].a.id}`)}>Mark next set</button>}
        {exam && exam.questions.length > 0 && <ExamMarking exam={exam} admin={admin} signedIn={!!ownerId} />}
        {unfinished.length > 0 && session?.id === id && <button className="primary" onClick={() => resume(unfinished[0].a.questionId)}>Continue session</button>}
        {study && !unfinished.length && <Link className="button" to={`/study/${study.code}`}>Compare answers with friends</Link>}
        <button className={unmarked.length === 0 ? "primary" : ""} onClick={finish}>{unfinished.length ? "Save & exit" : "Done"}</button>
      </div>
    </div>
  );
}
