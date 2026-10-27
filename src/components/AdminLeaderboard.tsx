import { useEffect, useState } from "react";
import { idToken } from "../lib/firebase";
import { fetchLeaderboard, sortRows, weekLabel, weekStart, type LeaderboardRow } from "../lib/leaderboard";
import { Avatar } from "./LeaderboardBoard";

interface ProgressRow { uid: string; name: string; email?: string; photo?: string; nickname?: string; joined: boolean; questions: number; sets: number; prevQuestions: number; prevSets: number; lastSeenAt?: number }

/** Every account's figures this week, computed on the server from their submitted answers. */
export default function AdminLeaderboard({ owner }: { owner: boolean }) {
  const [rows, setRows] = useState<ProgressRow[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const token = await idToken();
        const res = token ? await fetch("/api/progress", { headers: { authorization: `Bearer ${token}` } }) : null;
        if (res?.ok) {
          const body = (await res.json()) as { rows: ProgressRow[] };
          if (live) setRows(body.rows);
          return;
        }
        // Not configured yet: fall back to the rows students have published themselves.
        const message = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : "Sign in first.";
        const board: LeaderboardRow[] = await fetchLeaderboard(true);
        if (!live) return;
        setNote(res?.status === 503 ? `${message} Until then this shows only accounts that have opened the site this week.` : message ?? "");
        setRows(sortRows(board, "questions").map((r) => ({ uid: r.uid, name: r.name, photo: r.photo, nickname: r.name, joined: r.visible, questions: r.count, sets: r.sets, prevQuestions: r.prevCount, prevSets: r.prevSets })));
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not load progress."); }
    })();
    return () => { live = false; };
  }, [owner]);
  return (
    <details className="section admin-progress" open>
      <summary><h2>Student progress this week</h2></summary>
      <p className="muted">{weekLabel(weekStart(Date.now()))}. Every account, computed from their submitted answers, whether or not they joined the public board.</p>
      {note && <p className="muted" role="status">{note}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {!rows && !error && <p className="muted" role="status">Loading…</p>}
      {rows && !rows.length && <p className="muted">No accounts yet.</p>}
      {rows && rows.length > 0 && (
        <div className="admin-table-scroll"><table className="admin-progress-table">
          <thead><tr><th>#</th><th>Student</th>{owner && <th>Account</th>}<th>Questions</th><th>Sets</th><th>Last week</th><th>Board</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.uid}>
              <td className="muted">{i + 1}</td>
              <td><span className="admin-progress-name"><Avatar name={r.name} rank={99} photo={r.photo} />{r.name}{r.nickname && r.nickname !== r.name ? <span className="muted"> as {r.nickname}</span> : null}</span></td>
              {owner && <td className="muted">{r.email ?? ""}</td>}
              <td><strong>{r.questions}</strong></td>
              <td>{r.sets}</td>
              <td className="muted">{r.prevQuestions} questions, {r.prevSets} sets</td>
              <td>{r.joined ? <span className="muted">joined</span> : <span className="lb-you">not joined</span>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </details>
  );
}
