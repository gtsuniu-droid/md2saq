import { useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { Attempt, Mark, Question, QuestionSet, Settings } from "../data/types";
import { PRESENTATION_BY_ID, presentationName } from "../data/presentations";
import { historyEntries, historyGroups, type HistoryGroup } from "../lib/history";
import { truncate } from "../lib/questions";
import { setTitle } from "../lib/sets";
import { getProgressSyncState, subscribeProgressSync, syncNow } from "../lib/sync";

interface Props { attempts: Attempt[]; marks: Mark[]; questions: Question[]; sets: QuestionSet[]; settings: Settings }

function when(ts: number): string {
  return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 - 20) % 10] ?? ["th", "st", "nd", "rd"][n % 100] ?? "th"}`;
const pct = (g: HistoryGroup) => g.score !== undefined && g.maxScore ? Math.round((100 * g.score) / g.maxScore) : null;
const band = (p: number) => (p >= 70 ? "good" : p >= 50 ? "mid" : "low");

/** One sitting: what it was, when, how it went. The presentation sits above so the eye can scan. */
function Row({ g, sitting, caption = true }: { g: HistoryGroup; sitting: number; caption?: boolean }) {
  const unmarked = g.entries.find((e) => !e.mark)?.attempt ?? g.anchor;
  const name = g.presentation && g.label.startsWith(`${g.presentation} `) ? g.label.slice(g.presentation.length + 1) : g.label;
  const emoji = g.presentationId ? PRESENTATION_BY_ID.get(g.presentationId)?.emoji : undefined;
  const titled = !!g.set && !!setTitle(g.set);
  const p = pct(g);
  return (
    <li className={g.marked < g.total ? "unmarked" : undefined}>
      <div className="history-question">
        {caption && g.presentation && <span className="history-pres">{emoji && <span aria-hidden="true">{emoji}</span>}{g.presentation}</span>}
        <strong><Link to={`/history/${g.anchor.id}`}>{name}</Link></strong>
        {!titled && g.kind === "set" && <p className="muted">{truncate(g.text, 110)}</p>}
        {g.kind === "question" && <p className="muted">{truncate(g.text, 110)}</p>}
        <span className="muted history-meta">
          <time dateTime={new Date(g.submittedAt).toISOString()}>{when(g.submittedAt)}</time>
          {g.kind === "set" ? `, ${g.total} question${g.total === 1 ? "" : "s"}` : ", single question"}
          {g.mode === "exam" ? ", exam" : ""}
          {sitting > 1 ? `, ${ordinal(sitting)} sitting` : ""}
        </span>
      </div>
      <div className="history-result">
        {p !== null ? <>
          <span className="history-score">{g.score} / {g.maxScore}<small className={`history-pct ${band(p)}`}>{p}%</small></span>
          <span className="history-bar" aria-hidden="true"><span className={band(p)} style={{ width: `${p}%` }} /></span>
        </> : <span className="muted">{g.marked ? `${g.marked} of ${g.total} marked` : "Needs marking"}</span>}
        <span className="history-links">
          {g.reviewLater && <span className="review-later-label">⚑ Review later</span>}
          {g.marked < g.total ? <Link to={`/mark/${unmarked.id}`}>Mark</Link> : <Link to={`/history/${g.anchor.id}`}>Open</Link>}
        </span>
      </div>
    </li>
  );
}

/** Sittings, newest first or gathered under their presentation so it is easy to see what has been done. */
export default function AttemptHistory({ attempts, marks, questions, sets, settings }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"recent" | "presentation">("recent");
  const [limit, setLimit] = useState(10);
  const [message, setMessage] = useState("");
  const state = useSyncExternalStore(subscribeProgressSync, getProgressSyncState, getProgressSyncState);
  const ownerId = settings.cloudUser?.uid ?? "";
  const groups = useMemo(() => historyGroups(historyEntries(attempts, marks, questions, sets, ownerId), questions, presentationName), [attempts, marks, questions, sets, ownerId]);
  // Which sitting of the same set this is, counted oldest first.
  const sittingOf = useMemo(() => {
    const seen = new Map<string, number>(); const out = new Map<string, number>();
    for (const g of [...groups].sort((a, b) => a.submittedAt - b.submittedAt)) {
      if (g.kind !== "set" || !g.set) continue;
      const n = (seen.get(g.set.id) ?? 0) + 1; seen.set(g.set.id, n); out.set(g.key, n);
    }
    return out;
  }, [groups]);
  const query = search.trim().toLowerCase();
  const filtered = groups.filter((g) =>
    (filter === "all" || (filter === "review" ? g.reviewLater : filter === "unmarked" ? g.marked < g.total : g.mode === filter))
    && (!query || `${g.label} ${g.presentation ?? ""} ${g.set?.name ?? ""} ${g.text} ${g.entries.map((e) => `${e.text} ${e.mark?.notes ?? ""}`).join(" ")}`.toLowerCase().includes(query)));
  const sections = useMemo(() => {
    const by = new Map<string, HistoryGroup[]>();
    for (const g of filtered) by.set(g.presentation ?? "Other", [...(by.get(g.presentation ?? "Other") ?? []), g]);
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, rows]) => {
      const marked = rows.filter((r) => pct(r) !== null);
      const best = marked.length ? Math.max(...marked.map((r) => pct(r)!)) : null;
      const setsDone = new Set(rows.filter((r) => r.kind === "set" && r.set).map((r) => r.set!.id)).size;
      return { name, rows, best, setsDone, emoji: rows[0].presentationId ? PRESENTATION_BY_ID.get(rows[0].presentationId)?.emoji : undefined };
    });
  }, [filtered]);
  const sync = state.uid === ownerId ? state : null;
  const busy = sync?.status === "syncing";
  const refresh = async () => {
    setMessage("");
    try { if (!await syncNow()) setMessage("Sign in to sync your history."); }
    catch { /* The shared sync state shows the failure and keeps local history visible. */ }
  };
  const setsDoneAll = new Set(groups.filter((g) => g.kind === "set" && g.set).map((g) => g.set!.id)).size;
  return <section className="card home-card history-card" id="history" aria-labelledby="history-heading">
    <div className="row spread">
      <div><h2 id="history-heading">History</h2>{groups.length > 0 && <p className="muted history-summary">{setsDoneAll} {setsDoneAll === 1 ? "set" : "sets"} done across {new Set(groups.map((g) => g.presentation).filter(Boolean)).size} presentations, {groups.length} {groups.length === 1 ? "sitting" : "sittings"}.</p>}</div>
      {ownerId ? <button className="small" disabled={busy} onClick={() => void refresh()}>{busy ? "Syncing…" : "Sync history"}</button> : <Link to="/settings">Sign in to sync</Link>}
    </div>
    {(message || sync?.status === "error") && <p className="muted history-sync" role="status">{message || "Saved on this device. Cloud sync failed, try again."}</p>}
    {groups.length > 0 && <div className="row history-filters">
      <input type="search" aria-label="Search history" placeholder="Search sets, presentations or questions" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(10); }} />
      <select aria-label="Filter history" value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(10); }}><option value="all">All sittings</option><option value="practice">Practice</option><option value="exam">Exams</option><option value="unmarked">Needs marking</option><option value="review">Review later</option></select>
      <div className="seg" role="group" aria-label="Arrange history"><button className={view === "recent" ? "on" : ""} aria-pressed={view === "recent"} onClick={() => setView("recent")}>Recent</button><button className={view === "presentation" ? "on" : ""} aria-pressed={view === "presentation"} onClick={() => setView("presentation")}>By presentation</button></div>
    </div>}
    {!groups.length ? <p className="history-empty">No sittings yet.</p> : !filtered.length ? <p className="history-empty">Nothing matches your search.</p>
      : view === "presentation" ? sections.map((s) => (
        <details key={s.name} className="history-section" open>
          <summary><span className="history-section-name">{s.emoji && <span aria-hidden="true">{s.emoji}</span>}{s.name}</span><span className="muted">{s.setsDone} {s.setsDone === 1 ? "set" : "sets"} done, {s.rows.length} {s.rows.length === 1 ? "sitting" : "sittings"}{s.best !== null ? `, best ${s.best}%` : ""}</span></summary>
          <ol className="history-list">{s.rows.map((g) => <Row key={g.key} g={g} sitting={sittingOf.get(g.key) ?? 1} caption={false} />)}</ol>
        </details>
      ))
      : <ol className="history-list">{filtered.slice(0, limit).map((g) => <Row key={g.key} g={g} sitting={sittingOf.get(g.key) ?? 1} />)}</ol>}
    {filtered.length > 0 && view === "recent" && <div className="row spread history-more"><span className="muted">Showing {Math.min(limit, filtered.length)} of {filtered.length} sittings</span>{limit < filtered.length && <button className="small" onClick={() => setLimit((n) => n + 10)}>Show more</button>}</div>}
  </section>;
}
