import { useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { Attempt, Mark, Question, QuestionSet, Settings } from "../data/types";
import { historyEntries } from "../lib/history";
import { truncate } from "../lib/questions";
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
  const filtered = entries.filter((r) => (filter === "all" || (filter === "review" ? r.mark?.reviewLater : filter === "unmarked" ? !r.mark : r.attempt.mode === filter)) && (!query || `${r.label} ${r.set?.name ?? ""} ${r.text} ${r.mark?.notes ?? ""}`.toLowerCase().includes(query)));
  const sync = state.uid === ownerId ? state : null;
  const busy = sync?.status === "syncing";
  const refresh = async () => {
    setMessage("");
    try { if (!await syncNow()) setMessage("Sign in to sync your history."); }
    catch { /* The shared sync state shows the failure and keeps local history visible. */ }
  };
  return <section className="card home-card history-card" id="history" aria-labelledby="history-heading">
    <div className="row spread">
      <h2 id="history-heading">History</h2>
      {ownerId ? <button className="small" disabled={busy} onClick={() => void refresh()}>{busy ? "Syncing…" : "Sync history"}</button> : <Link to="/settings">Sign in to sync</Link>}
    </div>
    {(message || sync?.status === "error") && <p className="muted history-sync" role="status">{message || "Saved on this device. Cloud sync failed — try again."}</p>}
    {entries.length > 0 && <div className="row history-filters">
      <input type="search" aria-label="Search history" placeholder="Search questions or sets" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(10); }} />
      <select aria-label="Filter history" value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(10); }}><option value="all">All attempts</option><option value="practice">Practice</option><option value="exam">Exams</option><option value="unmarked">Needs marking</option><option value="review">Review later</option></select>
    </div>}
    {!entries.length ? <p className="history-empty">No attempts yet.</p> : !filtered.length ? <p className="history-empty">No attempts match your search.</p> : <ol className="history-list">{filtered.slice(0, limit).map(({ attempt, mark, label, text }) => <li key={attempt.id}>
      <div className="history-question"><strong><Link to={`/history/${attempt.id}`}>{label}</Link></strong><p>{truncate(text, 120)}</p><span className="muted"><time dateTime={new Date(attempt.submittedAt!).toISOString()}>{new Date(attempt.submittedAt!).toLocaleDateString([], { day: "numeric", month: "short", year: new Date(attempt.submittedAt!).getFullYear() === new Date().getFullYear() ? undefined : "numeric" })}</time></span></div>
      <div className="history-result">{mark?.reviewLater && <span className="review-later-label">⚑ Review later</span>}<span className={mark ? "history-score" : "muted"}>{mark ? `${mark.score} / ${mark.maxScore}` : "Needs marking"}</span><Link to={`/history/${attempt.id}`}>View whole set</Link></div>
    </li>)}</ol>}
    {filtered.length > 0 && <div className="row spread history-more"><span className="muted">Showing {Math.min(limit, filtered.length)} of {filtered.length} attempts</span>{limit < filtered.length && <button className="small" onClick={() => setLimit((n) => n + 10)}>Show more</button>}</div>}
  </section>;
}
