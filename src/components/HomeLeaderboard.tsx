import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Settings } from "../data/types";
import { cloudConfigured } from "../lib/firebase";
import { fetchLeaderboard, firstSentence, publishWeeklyCount, sortRows, standing, type LeaderboardRow } from "../lib/leaderboard";
import { declineLeaderboard, saveSocialSettings, USERNAME_MAX } from "../lib/social";
import { Avatar } from "./LeaderboardBoard";

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
    <section className="lb-optin" aria-label="Join the leaderboard">
      <div><strong>Join the weekly leaderboard?</strong><span className="muted"> Compare questions answered this week. Only a username you choose is shown.</span>{error && <p className="field-error" role="alert">{error}</p>}</div>
      <form className="lb-optin-actions" onSubmit={(e) => { e.preventDefault(); void join(); }}>
        <input aria-label="Username" placeholder="Choose a username" maxLength={USERNAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="primary small" disabled={busy || !name.trim()}>{busy ? "Joining…" : "Yes, join"}</button>
        <button type="button" className="small link" disabled={busy} onClick={() => void declineLeaderboard()}>No thanks</button>
      </form>
    </section>
  );
}

const MEDAL = ["gold", "silver", "bronze"];

/** One slim strip: the top three this week, where you stand, and the full board a click away. */
export default function HomeLeaderboard({ settings }: { settings: Settings }) {
  const user = settings.cloudUser;
  const social = settings.social;
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState("");
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

  if (!cloudConfigured() || !user) return null;
  if (!joined) return social?.declined ? null : <OptIn initial={social?.username ?? ""} />;
  const sorted = rows ? sortRows(rows, "questions") : [];
  const line = standing(sorted, user.uid, "questions");
  return (
    <section className="lb-strip" aria-label="Leaderboard this week">
      <div className="lb-strip-title"><svg viewBox="0 0 32 24" aria-hidden="true"><path d="M3 20h26l2-13-8 6-7-10-7 10-8-6z" fill="#e7ab23" /><rect x="3" y="20" width="26" height="3" rx="1" fill="#c98f12" /></svg><strong>This week</strong></div>
      {error ? <span className="field-error">{error}</span> : !rows ? <span className="muted" role="status">Loading…</span> : !sorted.length ? <span className="muted">Nobody has answered a question yet this week.</span> : (
        <ol className="lb-chips">
          {sorted.slice(0, 3).map((r, i) => <li key={r.uid} className={`lb-chip-row ${MEDAL[i]}${r.uid === user.uid ? " me" : ""}`}><Avatar name={r.name} rank={i + 1} photo={r.photo} /><span className="lb-chip-name">{r.name}</span><span className="lb-chip-count">{r.count}</span></li>)}
        </ol>
      )}
      {line && <span className="lb-strip-line muted">{firstSentence(line)}</span>}
      <Link to="/leaderboard" className="lb-more">Full leaderboard</Link>
    </section>
  );
}
