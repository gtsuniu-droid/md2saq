import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Settings } from "../data/types";
import { cloudConfigured } from "../lib/firebase";
import { boardName, fetchLeaderboard, firstSentence, publishWeeklyCount, sortRows, standing, type LeaderboardRow } from "../lib/leaderboard";
import { joinLeaderboard } from "../lib/social";
import { Avatar } from "./LeaderboardBoard";

const MEDAL = ["gold", "silver", "bronze"];

/** One slim strip: the top three this week, where you stand, and the full board a click away. */
export default function HomeLeaderboard({ settings }: { settings: Settings }) {
  const user = settings.cloudUser;
  const joined = settings.social?.leaderboard === true;
  const [joining, setJoining] = useState(false);
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let live = true;
    void (async () => {
      try {
        await publishWeeklyCount(user.uid).catch(() => undefined);
        const board = await fetchLeaderboard();
        if (live) setRows(board);
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not load the leaderboard."); }
    })();
    return () => { live = false; };
  }, [user?.uid, joined, settings.social?.username]);

  if (!cloudConfigured() || !user) return null;
  const sorted = rows ? sortRows(rows, "questions") : [];
  const line = joined ? standing(sorted, user.uid, "questions") : null;
  return (
    <section className="lb-strip" aria-label="Leaderboard this week">
      <div className="lb-strip-title"><svg viewBox="0 0 32 24" aria-hidden="true"><path d="M3 20h26l2-13-8 6-7-10-7 10-8-6z" fill="#e7ab23" /><rect x="3" y="20" width="26" height="3" rx="1" fill="#c98f12" /></svg><strong>This week</strong></div>
      {error ? <span className="field-error">{error}</span> : !rows ? <span className="muted" role="status">Loading…</span> : !sorted.length ? <span className="muted">Nobody has answered a question yet this week.</span> : (
        <ol className="lb-chips">
          {sorted.slice(0, 3).map((r, i) => <li key={r.uid} className={`lb-chip-row ${MEDAL[i]}${r.uid === user.uid ? " me" : ""}`}><Avatar name={r.name} rank={i + 1} photo={r.photo} /><span className="lb-chip-name">{r.name}</span><span className="lb-chip-count">{r.count}</span></li>)}
        </ol>
      )}
      {!joined ? <span className="lb-strip-line muted">Not on it yet. <button type="button" className="link lb-join" disabled={joining} onClick={() => { setJoining(true); void joinLeaderboard().finally(() => setJoining(false)); }}>{joining ? "Joining…" : `Join as ${boardName(settings)}`}</button> or <Link to="/settings#social">pick a nickname</Link>.</span>
        : line ? <span className="lb-strip-line muted">{firstSentence(line)}</span>
        : rows ? <span className="lb-strip-line muted">On the board as {boardName(settings)}.</span> : null}
      <Link to="/leaderboard" className="lb-more">Full leaderboard</Link>
    </section>
  );
}
