import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router";
import { db } from "../data/db";
import { formatDuration, truncate } from "../lib/questions";
import { loadSession, saveSession } from "../lib/session";

export default function SessionReviewPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const attempts = (await db.attempts.where("sessionId").equals(id).toArray()).filter((a) => a.submittedAt !== undefined);
    const questions = await db.questions.bulkGet(attempts.map((a) => a.questionId));
    const marks = await db.marks.where("attemptId").anyOf(attempts.map((a) => a.id)).toArray();
    const byAttempt = new Map(marks.map((m) => [m.attemptId, m]));
    return attempts.map((a, i) => ({ a, q: questions[i], m: byAttempt.get(a.id) }));
  }, [id]);

  if (!data) return null;
  const session = loadSession();
  const ordered = session?.id === id ? [...data].sort((x, y) => session.attemptIds.indexOf(x.a.id) - session.attemptIds.indexOf(y.a.id)) : data;
  const unmarked = ordered.filter((r) => !r.m);
  const total = ordered.reduce((acc, r) => acc + (r.m?.score ?? 0), 0);
  const max = ordered.reduce((acc, r) => acc + (r.m?.maxScore ?? 0), 0);

  const finish = () => {
    if (session?.id === id) saveSession(null);
    nav("/");
  };

  return (
    <div>
      <h1>Paper submitted</h1>
      <p className="muted">{ordered.length} questions, {formatDuration(ordered.reduce((acc, r) => acc + r.a.elapsedSec, 0))}, {unmarked.length} left to mark{max > 0 ? `, ${total}/${max} so far` : ""}</p>
      <table>
        <thead><tr><th>#</th><th>Question</th><th>Time</th><th>Mark</th></tr></thead>
        <tbody>
          {ordered.map((r, i) => (
            <tr key={r.a.id}>
              <td>{i + 1}</td>
              <td>{r.q ? truncate(r.q.text || r.q.parts[0]?.text || "") : "(deleted)"}</td>
              <td>{formatDuration(r.a.elapsedSec)}</td>
              <td>{r.m ? <Link to={`/mark/${r.a.id}`}>{r.m.score}/{r.m.maxScore}</Link> : <Link to={`/mark/${r.a.id}`}>Mark</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: "1rem" }}>
        {unmarked.length > 0 && <button className="primary" onClick={() => nav(`/mark/${unmarked[0].a.id}`)}>Mark next</button>}
        <button onClick={finish}>Finish</button>
      </div>
    </div>
  );
}
