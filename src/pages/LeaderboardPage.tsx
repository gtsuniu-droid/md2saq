import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { getSettings } from "../data/db";
import { cloudConfigured } from "../lib/firebase";
import { boardName, fetchLeaderboard, firstSentence, publishWeeklyCount, sortRows, standing, weekLabel, weekStart, type LeaderboardRow, type LeaderboardUnit } from "../lib/leaderboard";
import { BoardRows, Podium, UnitToggle, useBoardEntrance } from "../components/LeaderboardBoard";

/** Everyone who opted in, ranked by questions answered or sets completed this week. */
export default function LeaderboardPage() {
  const settings = useLiveQuery(getSettings, []);
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [unit, setUnit] = useState<LeaderboardUnit>("questions");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const user = settings?.cloudUser;
  const social = settings?.social;

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
  }, [user?.uid, social?.leaderboard, social?.username]);

  const sorted = rows ? sortRows(rows, unit) : [];
  useBoardEntrance(root, [rows !== null, unit]);

  if (!settings) return null;
  if (!cloudConfigured() || !user) return <div className="leaderboard"><h1>Leaderboard</h1><p className="muted">Sign in to see who has answered the most questions this week.</p></div>;
  const start = weekStart(Date.now());
  const line = standing(sorted, user.uid, unit);

  return (
    <div className="leaderboard" ref={root}>
      <header className="row spread leaderboard-head">
        <div><h1>Leaderboard</h1><p className="muted">{unit === "sets" ? "Sets completed" : "Questions answered"} this week, {weekLabel(start)}. Resets every Monday.</p></div>
        {social?.leaderboard !== true
          ? <Link className="button small" to="/settings#social">Join the board</Link>
          : <span className="lb-chip"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>On the board as {boardName(settings)}</span>}
      </header>
      <div className="row spread lb-controls"><span className="muted">Count by</span><UnitToggle unit={unit} onChange={setUnit} /></div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!rows && !error && <p className="muted" role="status">Loading…</p>}
      {rows && !sorted.length && <p className="muted">Nobody has answered a question yet this week.</p>}
      {sorted.length > 0 && (
        <>
          <Podium rows={sorted} unit={unit} me={user.uid} />
          {line && <div className="lb-standing"><p><strong>{firstSentence(line)}</strong>{line.includes(". ") ? ` ${line.slice(line.indexOf(". ") + 2)}` : ""}</p><Link to="/home#new-session" className="button primary">Practise now</Link></div>}
          <BoardRows rows={sorted} unit={unit} me={user.uid} />
        </>
      )}
      <p className="muted leaderboard-foot">Only students who joined are shown, under a nickname: their first name unless they chose another in Settings. Counts update when a device syncs.</p>
    </div>
  );
}
