import { useState } from "react";
import { Link } from "react-router";
import type { Settings } from "../data/types";
import { cloudConfigured } from "../lib/firebase";
import { boardName, questionsInWeek, sortRows, weekStart } from "../lib/leaderboard";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../data/db";
import { belongsToAccount } from "../lib/progressAccount";
import { joinLeaderboard } from "../lib/social";
import { useLeaderboard } from "../lib/useLeaderboard";
import { useSubmittedCount } from "../lib/useSubmittedCount";
import { Avatar, SignInToJoin } from "./LeaderboardBoard";

const MEDAL = ["gold", "silver", "bronze"];

/** One slim strip: the top three this week as a ranked row, you among them or after a divider, and the full board a click away. */
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
  // The top three, and your own place after them when you are further down.
  const myIndex = user ? sorted.findIndex((r) => r.uid === user.uid) : -1;
  const shown = sorted.slice(0, 3).map((r, i) => ({ r, i }));
  if (myIndex >= 3) shown.push({ r: sorted[myIndex], i: myIndex });
  const lead = sorted[0]?.count || 1;
  return (
    <section className="lb-strip" aria-label="Leaderboard this week">
      <div className="lb-strip-title"><svg viewBox="0 0 32 24" aria-hidden="true"><path d="M3 20h26l2-13-8 6-7-10-7 10-8-6z" fill="#e7ab23" /><rect x="3" y="20" width="26" height="3" rx="1" fill="#c98f12" /></svg><strong>This week</strong></div>
      {error ? <span className="lb-rank-row plain me"><span className="lb-rank-name">Your week</span><span className="lb-rank-count">{mine}</span></span>
        : !rows ? <span className="muted" role="status">Loading…</span>
        : !sorted.length ? <span className="muted">Nobody yet this week</span> : (
          <ol className="lb-rank">
            {shown.map(({ r, i }) => (
              <li key={r.uid} className={`lb-rank-row ${MEDAL[i] ?? "plain"}${r.uid === user?.uid ? " me" : ""}${i >= 3 ? " gap" : ""}`} aria-label={`${i + 1}. ${r.name}, ${r.count} questions`}>
                <span className="lb-rank-n">{i + 1}</span>
                <Avatar name={r.name} rank={i + 1} photo={r.photo} />
                <span className="lb-rank-name">{r.name}{r.uid === user?.uid && <span className="lb-rank-you">you</span>}</span>
                <span className="lb-rank-count">{r.count}</span>
                <span className="lb-rank-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.round((100 * r.count) / lead))}%` }} /></span>
              </li>
            ))}
          </ol>
        )}
      {!user ? <SignInToJoin small />
        : !onBoard && rows ? <span className="lb-strip-line"><button type="button" className="link lb-join" disabled={joining} onClick={() => { setJoining(true); void joinLeaderboard().finally(() => setJoining(false)); }}>{joining ? "Joining…" : `Join as ${boardName(settings)}`}</button><Link className="muted lb-nick" to="/settings#social">Nickname</Link></span>
        : null}
      <Link to="/leaderboard" className="lb-more">Full leaderboard<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></Link>
    </section>
  );
}
