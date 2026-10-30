import { useState } from "react";
import { Link } from "react-router";
import type { Settings } from "../data/types";
import { cloudConfigured } from "../lib/firebase";
import { boardName, firstSentence, questionsInWeek, sortRows, standing, weekStart } from "../lib/leaderboard";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../data/db";
import { belongsToAccount } from "../lib/progressAccount";
import { joinLeaderboard } from "../lib/social";
import { useLeaderboard } from "../lib/useLeaderboard";
import { useSubmittedCount } from "../lib/useSubmittedCount";
import { Avatar, SignInToJoin } from "./LeaderboardBoard";

const MEDAL = ["gold", "silver", "bronze"];

/** One slim strip: the top three this week, where you stand, and the full board a click away. */
export default function HomeLeaderboard({ settings }: { settings: Settings }) {
  const user = settings.cloudUser;
  const joined = settings.social?.leaderboard === true;
  const [joining, setJoining] = useState(false);
  // Re-publish and re-read as soon as a question is submitted, so the count moves at once;
  // otherwise the strip refreshes every minute while the home page is in view.
  const submitted = useSubmittedCount(user?.uid);
  const { rows, error } = useLeaderboard(user?.uid, [joined, settings.social?.username, submitted], 60_000);
  // This device's own figure for the week: shown whenever the board cannot be read, so it is never stale for you.
  const mine = useLiveQuery(async () => user ? questionsInWeek(await db.attempts.filter((a) => belongsToAccount(a, user.uid) && a.submittedAt !== undefined).toArray(), user.uid, weekStart(Date.now())) : 0, [user?.uid, submitted]) ?? 0;

  if (!cloudConfigured() || (error && !user)) return null;
  const sorted = rows ? sortRows(rows, "questions") : [];
  // The board is the truth: a device that never saw the student join still shows them as on it.
  const onBoard = joined || sorted.some((r) => r.uid === user?.uid);
  const line = user && onBoard ? standing(sorted, user.uid, "questions") : null;
  return (
    <section className="lb-strip" aria-label="Leaderboard this week">
      <div className="lb-strip-title"><svg viewBox="0 0 32 24" aria-hidden="true"><path d="M3 20h26l2-13-8 6-7-10-7 10-8-6z" fill="#e7ab23" /><rect x="3" y="20" width="26" height="3" rx="1" fill="#c98f12" /></svg><strong>This week</strong></div>
      {error ? <span className="muted">Your week so far: <strong>{mine}</strong> {mine === 1 ? "question" : "questions"}.</span> : !rows ? <span className="muted" role="status">Loading…</span> : !sorted.length ? <span className="muted">Nobody has answered a question yet this week.</span> : (
        <ol className="lb-chips">
          {sorted.slice(0, 3).map((r, i) => <li key={r.uid} className={`lb-chip-row ${MEDAL[i]}${r.uid === user?.uid ? " me" : ""}`}><Avatar name={r.name} rank={i + 1} photo={r.photo} /><span className="lb-chip-name">{r.name}</span><span className="lb-chip-count">{r.count}</span></li>)}
        </ol>
      )}
      {!user ? <span className="lb-strip-line lb-strip-invite"><span className="muted">Get on the board and keep your progress on every device.</span><SignInToJoin small /></span>
        : !onBoard ? <span className="lb-strip-line muted">Not on it yet. <button type="button" className="link lb-join" disabled={joining} onClick={() => { setJoining(true); void joinLeaderboard().finally(() => setJoining(false)); }}>{joining ? "Joining…" : `Join as ${boardName(settings)}`}</button> or <Link to="/settings#social">pick a nickname</Link>.</span>
        : line ? <span className="lb-strip-line muted">{firstSentence(line)}</span>
        : rows ? <span className="lb-strip-line muted">On the board as {boardName(settings)}.</span> : null}
      <Link to="/leaderboard" className="lb-more">Full leaderboard</Link>
    </section>
  );
}
