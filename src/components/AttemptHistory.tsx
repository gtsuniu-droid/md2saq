import { useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { Attempt, Mark, Question, QuestionSet, Settings } from "../data/types";
import { historyEntries } from "../lib/history";
import { formatDuration, truncate } from "../lib/questions";
import { getProgressSyncState, subscribeProgressSync, syncNow } from "../lib/sync";

interface Props { attempts: Attempt[]; marks: Mark[]; questions: Question[]; sets: QuestionSet[]; settings: Settings }
export default function AttemptHistory({ attempts, marks, questions, sets, settings }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(10);
  const [message, setMessage] = useState("");
  const state = useSyncExternalStore(subscribeProgressSync, getProgressSyncState, getProgressSyncState);
  const ownerId = settings.cloudUser?.uid ?? "";
  const entries = useMemo(() => historyEntries(attempts, marks, questions, sets, ownerId), [attempts, marks, questions, sets, ownerId]);
  const query = search.trim().toLowerCase();
  const filtered = entries.filter((r) => (filter === "all" || (filter === "unmarked" ? !r.mark : r.attempt.mode === filter)) && (!query || `${r.label} ${r.set?.name ?? ""} ${r.text}`.toLowerCase().includes(query)));
  const sync = state.uid === ownerId ? state : null;
  const busy = sync?.status === "syncing";
  const refresh = async () => {
    setMessage("");
    try { if (!await syncNow()) setMessage("Sign in to sync your history."); }
    catch { /* The shared sync state shows the failure and keeps local history visible. */ }
  };
  return <section className="card home-card history-card" id="history" aria-labelledby="history-heading">
    <div className="row spread">
      <div><h2 id="history-heading">History</h2><p className="muted">Your attempted questions, newest first.</p></div>
      {ownerId ? <button className="small" disabled={busy} onClick={() => void refresh()}>{busy ? "Syncing…" : "Sync history"}</button> : <Link to="/settings">Sign in to sync</Link>}
    </div>
    <p className="muted history-sync" role="status">{message || (!ownerId ? "Saved on this device. Sign in to keep your history across devices." : busy ? "Syncing your account history…" : sync?.status === "error" ? "History is saved on this device. Cloud sync failed; try Sync history again." : sync?.status === "synced" ? `Last synced ${new Date(sync.at!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${settings.cloudUser?.email ?? "Your account"}` : `History syncs to ${settings.cloudUser?.email ?? "your account"}.`)}</p>
    {entries.length > 0 && <div className="row history-filters">
      <input type="search" aria-label="Search history" placeholder="Search questions or sets" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(10); }} />
      <select aria-label="Filter history" value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(10); }}><option value="all">All attempts</option><option value="practice">Practice</option><option value="exam">Exams</option><option value="unmarked">Needs marking</option></select>
    </div>}
    {!entries.length ? <p className="history-empty">No attempts yet. Submitted questions will appear here.</p> : !filtered.length ? <p className="history-empty">No attempts match your search.</p> : <ol className="history-list">{filtered.slice(0, limit).map(({ attempt, mark, question, set, label, text }) => <li key={attempt.id}>
      <div className="history-question"><strong>{label}</strong>{set?.name && set.name !== label.split(" · ")[0] && <span className="muted">{set.name}</span>}<p>{truncate(text, 180)}</p><span className="muted"><time dateTime={new Date(attempt.submittedAt!).toISOString()}>{new Date(attempt.submittedAt!).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time> · {attempt.mode === "exam" ? "Exam" : "Practice"} · {formatDuration(attempt.elapsedSec)}</span></div>
      <div className="history-result"><span className={mark ? "history-score" : "muted"}>{mark ? `${mark.score} / ${mark.maxScore}` : "Needs marking"}</span>{question ? <Link to={`/mark/${attempt.id}`}>{mark ? "Review answer" : "Mark answer"}</Link> : <span className="muted">Question unavailable</span>}</div>
    </li>)}</ol>}
    {filtered.length > 0 && <div className="row spread history-more"><span className="muted">Showing {Math.min(limit, filtered.length)} of {filtered.length} attempts</span>{limit < filtered.length && <button className="small" onClick={() => setLimit((n) => n + 10)}>Show more</button>}</div>}
  </section>;
}
