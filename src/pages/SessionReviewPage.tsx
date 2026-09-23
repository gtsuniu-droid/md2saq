import { belongsToAccount } from "../lib/progressAccount";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router";
import { db, getSettings } from "../data/db";
import { formatDuration, truncate } from "../lib/questions";
import { loadSession, saveSession } from "../lib/session";
import { sessionAtQuestion } from "../lib/sessionNavigation";

export default function SessionReviewPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const ownerId = (await getSettings()).cloudUser?.uid ?? "";
    const attempts = (await db.attempts.where("sessionId").equals(id).toArray()).filter((a) => belongsToAccount(a, ownerId));
    const questions = await db.questions.bulkGet(attempts.map((a) => a.questionId));
    const marks = await db.marks.where("attemptId").anyOf(attempts.map((a) => a.id)).filter((m) => belongsToAccount(m, ownerId)).toArray();
    const byAttempt = new Map(marks.map((m) => [m.attemptId, m]));
    return attempts.map((a, i) => ({ a, q: questions[i], m: byAttempt.get(a.id) }));
  }, [id]);

  if (!data) return null;
  const session = loadSession();
  const ordered = session?.id === id ? [...data].sort((x, y) => session.attemptIds.indexOf(x.a.id) - session.attemptIds.indexOf(y.a.id)) : data;
  const unmarked = ordered.filter((r) => r.a.submittedAt !== undefined && !r.m);
  const unfinished = ordered.filter((r) => r.a.submittedAt === undefined);
  const total = ordered.reduce((acc, r) => acc + (r.m?.score ?? 0), 0);
  const max = ordered.reduce((acc, r) => acc + (r.m?.maxScore ?? 0), 0);

  const finish = () => {
    if (session?.id === id && !unfinished.length) saveSession(null);
    nav("/");
  };
  const resume = (questionId: string) => {
    if (!session || session.id !== id) return;
    saveSession(sessionAtQuestion(session, ordered.flatMap((r) => r.q ? [r.q] : []), session.questionIds.indexOf(questionId)));
    nav("/paper");
  };

  return (
    <div>
      <h1>{unfinished.length ? "Session in progress" : unmarked.length === 0 ? "Session complete" : "Paper submitted"}</h1>
      <p className="muted">{ordered.length} questions, {formatDuration(ordered.reduce((acc, r) => acc + r.a.elapsedSec, 0))}, {unmarked.length} left to mark{unfinished.length ? `, ${unfinished.length} still to submit` : ""}{max > 0 ? `, ${total}/${max} so far` : ""}</p>
      <table>
        <thead><tr><th>#</th><th>Question</th><th>Time</th><th>Mark</th></tr></thead>
        <tbody>
          {ordered.map((r, i) => (
            <tr key={r.a.id}>
              <td>{i + 1}</td>
              <td>{r.q ? truncate(r.q.text || r.q.parts[0]?.text || "") : "(deleted)"}{r.m?.reviewLater && <span className="review-later-label"> ⚑ Review later</span>}</td>
              <td>{formatDuration(r.a.elapsedSec)}</td>
              <td>{r.a.submittedAt === undefined ? session?.id === id ? <button className="small" onClick={() => resume(r.a.questionId)}>Continue</button> : "Not submitted" : r.m ? <Link to={`/mark/${r.a.id}`}>{r.m.score}/{r.m.maxScore}</Link> : <Link to={`/mark/${r.a.id}`}>Mark</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: "1rem" }}>
        {unmarked.length > 0 && <button className="primary" onClick={() => nav(`/mark/${unmarked[0].a.id}`)}>Mark next</button>}
        {unfinished.length > 0 && session?.id === id && <button className="primary" onClick={() => resume(unfinished[0].a.questionId)}>Continue session</button>}
        <button className={unmarked.length === 0 ? "primary" : ""} onClick={finish}>{unfinished.length ? "Save & exit" : "Done"}</button>
      </div>
    </div>
  );
}
