import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Settings } from "../data/types";
import { cloudConfigured } from "../lib/firebase";
import { fetchLeaderboard, publishWeeklyCount, sortRows, standing, type LeaderboardRow, type LeaderboardUnit } from "../lib/leaderboard";
import { declineLeaderboard, saveSocialSettings, USERNAME_MAX } from "../lib/social";
import { Podium, UnitToggle, useBoardEntrance } from "./LeaderboardBoard";

/** Asked once; yes joins with a username, no hides this until Settings turns it on. */
function OptIn({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const join = async () => {
    setBusy(true); setError("");
    try { await saveSocialSettings({ username: name, leaderboard: true }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not join."); }
    finally { setBusy(false); }
  };
  return (
    <section className="card home-card lb-optin" aria-label="Join the leaderboard">
      <div>
        <strong>Join the weekly leaderboard?</strong>
        <p className="muted">See how your week compares with other students. Only a username you choose is shown, never your name.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
      <form className="lb-optin-actions" onSubmit={(e) => { e.preventDefault(); void join(); }}>
        <input aria-label="Username" placeholder="Choose a username" maxLength={USERNAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="primary" disabled={busy || !name.trim()}>{busy ? "Joining…" : "Yes, join"}</button>
        <button type="button" className="link" disabled={busy} onClick={() => void declineLeaderboard()}>No thanks</button>
      </form>
    </section>
  );
}

/** The week at a glance: the top three and where this person stands, with the full board a click away. */
export default function HomeLeaderboard({ settings }: { settings: Settings }) {
  const user = settings.cloudUser;
  const social = settings.social;
  const [unit, setUnit] = useState<LeaderboardUnit>("questions");
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const joined = !!social?.leaderboard && !!social.username;

  useEffect(() => {
    if (!user || !joined) return;
    let live = true;
    void (async () => {
      try {
        await publishWeeklyCount(user.uid).catch(() => undefined);
        const board = await fetchLeaderboard();
        if (live) setRows(board);
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not load the leaderboard."); }
    })();
    return () => { live = false; };
  }, [user?.uid, joined]);

  const sorted = rows ? sortRows(rows, unit) : [];
  useBoardEntrance(root, [rows !== null, unit]);

  if (!cloudConfigured() || !user) return null;
  if (!joined) return social?.declined ? null : <OptIn initial={social?.username ?? ""} />;
  const line = standing(sorted, user.uid, unit);
  return (
    <section className="card home-card home-leaderboard" aria-label="Leaderboard this week" ref={root}>
      <div className="row spread">
        <h2 className="section-heading">Leaderboard</h2>
        <UnitToggle unit={unit} onChange={setUnit} small />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!rows && !error && <p className="muted" role="status">Loading…</p>}
      {rows && !sorted.length && <p className="muted">Nobody has answered a question yet this week.</p>}
      {sorted.length > 0 && <Podium rows={sorted} unit={unit} me={user.uid} compact />}
      {line && <p className="lb-standing-line">{line}</p>}
      <Link to="/leaderboard" className="lb-more">Full leaderboard</Link>
    </section>
  );
}
