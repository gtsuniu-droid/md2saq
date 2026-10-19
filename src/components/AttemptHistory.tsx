import { useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { Attempt, Mark, Question, QuestionSet, Settings } from "../data/types";
import { presentationName } from "../data/presentations";
import { historyEntries, historyGroups } from "../lib/history";
import { truncate } from "../lib/questions";
import { getProgressSyncState, subscribeProgressSync, syncNow } from "../lib/sync";

interface Props { attempts: Attempt[]; marks: Mark[]; questions: Question[]; sets: QuestionSet[]; settings: Settings }

function when(ts: number): string {
  return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** One row per sitting: the set, its presentation and the total score; a lone question stays a question. */
export default function AttemptHistory({ attempts, marks, questions, sets, settings }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(10);
  const [message, setMessage] = useState("");
  const state = useSyncExternalStore(subscribeProgressSync, getProgressSyncState, getProgressSyncState);
  const ownerId = settings.cloudUser?.uid ?? "";
  const groups = useMemo(() => historyGroups(historyEntries(attempts, marks, questions, sets, ownerId), questions, presentationName), [attempts, marks, questions, sets, ownerId]);
  const query = search.trim().toLowerCase();
  const filtered = groups.filter((g) =>
    (filter === "all" || (filter === "review" ? g.reviewLater : filter === "unmarked" ? g.marked < g.total : g.mode === filter))
    && (!query || `${g.label} ${g.presentation ?? ""} ${g.set?.name ?? ""} ${g.text} ${g.entries.map((e) => `${e.text} ${e.mark?.notes ?? ""}`).join(" ")}`.toLowerCase().includes(query)));
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
    {groups.length > 0 && <div className="row history-filters">
      <input type="search" aria-label="Search history" placeholder="Search sets, presentations or questions" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(10); }} />
      <select aria-label="Filter history" value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(10); }}><option value="all">All sittings</option><option value="practice">Practice</option><option value="exam">Exams</option><option value="unmarked">Needs marking</option><option value="review">Review later</option></select>
    </div>}
    {!groups.length ? <p className="history-empty">No sittings yet.</p> : !filtered.length ? <p className="history-empty">Nothing matches your search.</p> : <ol className="history-list">{filtered.slice(0, limit).map((g) => {
      const unmarked = g.entries.find((e) => !e.mark)?.attempt ?? g.anchor;
      return <li key={g.key}>
        <div className="history-question">
          <strong><Link to={`/history/${g.anchor.id}`}>{g.label}</Link></strong>
          <p>{truncate(g.text, 120)}</p>
          <span className="muted">
            <time dateTime={new Date(g.submittedAt).toISOString()}>{when(g.submittedAt)}</time>
            {g.kind === "set" ? ` · ${g.total} question${g.total === 1 ? "" : "s"}` : " · single question"}{g.mode === "exam" ? " · exam" : ""}
          </span>
        </div>
        <div className="history-result">
          {g.reviewLater && <span className="review-later-label">⚑ Review later</span>}
          {g.score !== undefined ? <span className="history-score">{g.score} / {g.maxScore}</span>
            : <span className="muted">{g.marked ? `${g.marked} of ${g.total} marked` : "Needs marking"}</span>}
          {g.marked < g.total ? <Link to={`/mark/${unmarked.id}`}>Mark</Link> : <Link to={`/history/${g.anchor.id}`}>Open</Link>}
        </div>
      </li>;
    })}</ol>}
    {filtered.length > 0 && <div className="row spread history-more"><span className="muted">Showing {Math.min(limit, filtered.length)} of {filtered.length} sittings</span>{limit < filtered.length && <button className="small" onClick={() => setLimit((n) => n + 10)}>Show more</button>}</div>}
  </section>;
}
