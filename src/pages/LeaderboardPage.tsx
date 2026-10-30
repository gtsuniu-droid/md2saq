import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useRef, useState } from "react";
import { leaderLine } from "../lib/leaderLines";
import { Link } from "react-router";
import { getSettings } from "../data/db";
import { cloudConfigured } from "../lib/firebase";
import { boardName, firstSentence, sortRows, standing, weekLabel, weekStart, type LeaderboardPeriod, type LeaderboardUnit } from "../lib/leaderboard";
import { BoardRows, PeriodToggle, Podium, SignInToJoin, UnitToggle, useBoardEntrance } from "../components/LeaderboardBoard";
import { useLeaderboard } from "../lib/useLeaderboard";
import { useSubmittedCount } from "../lib/useSubmittedCount";

/** Everyone who opted in, ranked by questions answered or sets completed this week. */
export default function LeaderboardPage() {
  const settings = useLiveQuery(getSettings, []);
  const [unit, setUnit] = useState<LeaderboardUnit>("questions");
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const root = useRef<HTMLDivElement>(null);
  const user = settings?.cloudUser;
  const social = settings?.social;
  const submitted = useSubmittedCount(user?.uid);

  // Published on opening and on every submitted answer, then refreshed every minute while in view.
  const { rows, error } = useLeaderboard(user?.uid, [social?.leaderboard, social?.username, submitted]);

  const sorted = rows ? sortRows(rows, unit, period) : [];
  // A line for the week's leader, picked once per visit.
  const pick = useMemo(() => Math.random(), []);
  const crow = period === "week" && sorted[0] ? leaderLine(sorted[0].name, sorted[0].count, pick) : null;
  useBoardEntrance(root, [rows !== null, unit, period]);

  if (!settings) return null;
  if (!cloudConfigured()) return <div className="leaderboard"><h1>Leaderboard</h1><p className="muted">The leaderboard needs the site's sign-in to be set up.</p></div>;
  const start = weekStart(Date.now());
  const line = user ? standing(sorted, user.uid, unit, period) : null;
  // The board is the truth: a device that never saw the student join still shows them as on it.
  const onBoard = social?.leaderboard === true || sorted.some((r) => r.uid === user?.uid);

  return (
    <div className="leaderboard" ref={root}>
      <header className="row spread leaderboard-head">
        <div><h1>Leaderboard</h1><p className="muted">{unit === "sets" ? "Sets completed" : "Questions answered"}{period === "all" ? " since each student began." : ` this week, ${weekLabel(start)}. Resets every Monday.`}</p></div>
        {!user ? <SignInToJoin small />
          : !onBoard
          ? <Link className="button small" to="/settings#social">Join the board</Link>
          : <span className="lb-chip"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>On the board as {boardName(settings)}</span>}
      </header>
      <div className="row spread lb-controls"><PeriodToggle period={period} onChange={setPeriod} /><UnitToggle unit={unit} onChange={setUnit} /></div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!rows && !error && <p className="muted" role="status">Loading…</p>}
      {rows && !sorted.length && <p className="muted">{period === "all" ? "Nobody has answered a question yet." : "Nobody has answered a question yet this week."}</p>}
      {!user && rows && <div className="lb-standing lb-invite"><p><strong>Want your name up here?</strong> Sign in with Google, answer questions, and join the board from your home page. Your progress follows you to every device.</p><SignInToJoin /></div>}
      {sorted.length > 0 && (
        <>
          <Podium rows={sorted} unit={unit} me={user?.uid ?? ""} period={period} />
          {crow && <p className="lb-crow" role="status">{crow}</p>}
          {line && <div className="lb-standing"><p><strong>{firstSentence(line)}</strong>{line.includes(". ") ? ` ${line.slice(line.indexOf(". ") + 2)}` : ""}</p><Link to="/home#new-session" className="button primary">Practise now</Link></div>}
          <BoardRows rows={sorted} unit={unit} me={user?.uid ?? ""} period={period} />
        </>
      )}
      <p className="muted leaderboard-foot">Only students who joined are shown, under a nickname: their first name unless they chose another in Settings. Counts update whenever a student opens the board or syncs.</p>
    </div>
  );
}
