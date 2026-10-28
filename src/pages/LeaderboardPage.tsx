import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { getSettings } from "../data/db";
import { cloudConfigured } from "../lib/firebase";
import { boardName, fetchLeaderboard, firstSentence, publishWeeklyCount, sortRows, standing, weekLabel, weekStart, type LeaderboardRow, type LeaderboardUnit } from "../lib/leaderboard";
import { BoardRows, Podium, SignInToJoin, UnitToggle, useBoardEntrance } from "../components/LeaderboardBoard";
import { useSubmittedCount } from "../lib/useSubmittedCount";

/** Everyone who opted in, ranked by questions answered or sets completed this week. */
export default function LeaderboardPage() {
  const settings = useLiveQuery(getSettings, []);
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [unit, setUnit] = useState<LeaderboardUnit>("questions");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const user = settings?.cloudUser;
  const social = settings?.social;
  const submitted = useSubmittedCount(user?.uid);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        // Signed in: publish this week's count and get the board back with it, in one request.
        const board = (user ? await publishWeeklyCount(user.uid).catch(() => null) : null) ?? await fetchLeaderboard();
        if (live) setRows(board.rows);
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not load the leaderboard."); }
    })();
    return () => { live = false; };
  }, [user?.uid, social?.leaderboard, social?.username, submitted]);

  const sorted = rows ? sortRows(rows, unit) : [];
  useBoardEntrance(root, [rows !== null, unit]);

  if (!settings) return null;
  if (!cloudConfigured()) return <div className="leaderboard"><h1>Leaderboard</h1><p className="muted">The leaderboard needs the site's sign-in to be set up.</p></div>;
  const start = weekStart(Date.now());
  const line = user ? standing(sorted, user.uid, unit) : null;
  // The board is the truth: a device that never saw the student join still shows them as on it.
  const onBoard = social?.leaderboard === true || sorted.some((r) => r.uid === user?.uid);

  return (
    <div className="leaderboard" ref={root}>
      <header className="row spread leaderboard-head">
        <div><h1>Leaderboard</h1><p className="muted">{unit === "sets" ? "Sets completed" : "Questions answered"} this week, {weekLabel(start)}. Resets every Monday.</p></div>
        {!user ? <SignInToJoin small />
          : !onBoard
          ? <Link className="button small" to="/settings#social">Join the board</Link>
          : <span className="lb-chip"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>On the board as {boardName(settings)}</span>}
      </header>
      <div className="row spread lb-controls"><span className="muted">Count by</span><UnitToggle unit={unit} onChange={setUnit} /></div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!rows && !error && <p className="muted" role="status">Loading…</p>}
      {rows && !sorted.length && <p className="muted">Nobody has answered a question yet this week.</p>}
      {!user && rows && <div className="lb-standing lb-invite"><p><strong>Want your name up here?</strong> Sign in with Google, answer questions, and join the board from your home page. Your progress follows you to every device.</p><SignInToJoin /></div>}
      {sorted.length > 0 && (
        <>
          <Podium rows={sorted} unit={unit} me={user?.uid ?? ""} />
          {line && <div className="lb-standing"><p><strong>{firstSentence(line)}</strong>{line.includes(". ") ? ` ${line.slice(line.indexOf(". ") + 2)}` : ""}</p><Link to="/home#new-session" className="button primary">Practise now</Link></div>}
          <BoardRows rows={sorted} unit={unit} me={user?.uid ?? ""} />
        </>
      )}
      <p className="muted leaderboard-foot">Only students who joined are shown, under a nickname: their first name unless they chose another in Settings. Counts update whenever a student opens the board or syncs.</p>
    </div>
  );
}
