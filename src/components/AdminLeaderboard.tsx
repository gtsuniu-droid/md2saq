import { useEffect, useState } from "react";
import { fetchLeaderboard, sortRows, weekLabel, weekStart, type LeaderboardRow } from "../lib/leaderboard";
import { listMembers, type Member } from "../lib/members";
import { Avatar } from "./LeaderboardBoard";

/** Every account's figures this week, hidden rows included, for admins following progress. */
export default function AdminLeaderboard({ owner }: { owner: boolean }) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [members, setMembers] = useState<Map<string, Member>>(new Map());
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [board, people] = await Promise.all([fetchLeaderboard(true), owner ? listMembers().catch(() => [] as Member[]) : Promise.resolve([] as Member[])]);
        if (!live) return;
        setRows(sortRows(board, "questions")); setMembers(new Map(people.map((m) => [m.uid, m])));
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not load progress."); }
    })();
    return () => { live = false; };
  }, [owner]);
  return (
    <details className="section admin-progress" open>
      <summary><h2>Student progress this week</h2></summary>
      <p className="muted">{weekLabel(weekStart(Date.now()))}. Every signed-in account, whether or not they joined the public board.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!rows && !error && <p className="muted" role="status">Loading…</p>}
      {rows && !rows.length && <p className="muted">No figures yet this week.</p>}
      {rows && rows.length > 0 && (
        <div className="admin-table-scroll"><table className="admin-progress-table">
          <thead><tr><th>#</th><th>Student</th>{owner && <th>Account</th>}<th>Questions</th><th>Sets</th><th>Last week</th><th>Board</th></tr></thead>
          <tbody>{rows.map((r, i) => { const m = members.get(r.uid); return (
            <tr key={r.uid}>
              <td className="muted">{i + 1}</td>
              <td><span className="admin-progress-name"><Avatar name={r.name} rank={99} photo={r.photo} />{r.name}</span></td>
              {owner && <td className="muted">{m ? `${m.name || ""}${m.email ? ` (${m.email})` : ""}` : ""}</td>}
              <td><strong>{r.count}</strong></td>
              <td>{r.sets}</td>
              <td className="muted">{r.prevCount} questions, {r.prevSets} sets</td>
              <td>{r.visible ? <span className="muted">joined</span> : <span className="lb-you">not joined</span>}</td>
            </tr>); })}</tbody>
        </table></div>
      )}
    </details>
  );
}
