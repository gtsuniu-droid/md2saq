import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { db, getSettings } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import Heatmap from "../components/Heatmap";
import { formatDuration, totalMarks } from "../lib/questions";
import { discardSession, startSession } from "../lib/session";
import { remainingSec } from "../lib/sessionClock";
import { useSession } from "../lib/useSession";
import { answeredPerDay, compileQuestions, heatGrid, presentationProgress, summarise } from "../lib/stats";

type Range = "week" | "year" | "overall";
const DAY_MS = 24 * 3600 * 1000;
const PARENT_OF = new Map(PRESENTATIONS.filter((p) => p.parent).map((p) => [p.id, p.parent!]));

export default function HomePage() {
  const nav = useNavigate();
  const [range, setRange] = useState<Range>("year");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newOnly, setNewOnly] = useState(false);
  const [count, setCount] = useState("");
  const [mode, setMode] = useState<"practice" | "exam">("practice");
  const [minutes, setMinutes] = useState("");
  const [search, setSearch] = useState("");
  const session = useSession();
  const inProgress = useLiveQuery(async () => {
    if (!session) return null;
    const attempts = await db.attempts.where("sessionId").equals(session.id).toArray();
    return { submitted: attempts.filter((a) => a.submittedAt !== undefined).length, answered: attempts.filter((a) => a.answers.some((x) => x.text.trim())).length };
  }, [session?.id]);

  const data = useLiveQuery(async () => {
    const [questions, attempts, marks, settings] = await Promise.all([
      db.questions.toArray(),
      db.attempts.toArray(),
      db.marks.toArray(),
      getSettings(),
    ]);
    return { questions, attempts, marks, settings };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const submitted = data.attempts.filter((a) => a.submittedAt !== undefined);
    const first = submitted.length ? Math.min(...submitted.map((a) => a.submittedAt!)) : now;
    const days = range === "week" ? 7 : range === "year" ? 365 : Math.max(7, Math.ceil((now - first) / DAY_MS) + 1);
    const from = new Date(now - (days - 1) * DAY_MS).setHours(0, 0, 0, 0);
    const perDay = answeredPerDay(submitted.filter((a) => a.submittedAt! >= from - DAY_MS));
    return {
      grid: heatGrid(perDay, now, days),
      summary: summarise(data.attempts, data.marks, range === "overall" ? undefined : from),
      progress: presentationProgress(data.questions, data.attempts, data.marks, PRESENTATIONS.map((p) => p.id), PARENT_OF),
    };
  }, [data, range]);

  if (!data || !view) return null;
  const { summary, progress } = view;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const visible = PRESENTATIONS.filter((p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const withQuestions = visible.filter((p) => (progress.get(p.id)?.total ?? 0) > 0);
  const allSelected = withQuestions.length > 0 && withQuestions.every((p) => selected.has(p.id));

  const pool = compileQuestions(data.questions, data.attempts, [...selected], { newOnly, random: () => 0.5, parentOf: PARENT_OF });
  const n = count.trim() === "" ? pool.length : Math.min(pool.length, Number(count));
  const suggestedMinutes = Math.max(
    1,
    Math.round(pool.slice(0, n).reduce((acc, q) => acc + (totalMarks(q) ?? 4) * data.settings.minutesPerMark, 0)),
  );

  const start = () => {
    const picked = compileQuestions(data.questions, data.attempts, [...selected], { newOnly, count: count.trim() === "" ? undefined : Number(count), random: Math.random, parentOf: PARENT_OF });
    if (picked.length === 0) return;
    const mins = minutes.trim() === "" ? suggestedMinutes : Number(minutes);
    startSession(picked.map((q) => q.id), mode, mins > 0 ? Math.round(mins * 60) : undefined);
    nav("/paper");
  };

  const left = session ? remainingSec(session, Date.now()) : null;
  const total = session?.questionIds.length ?? 0;
  const done = inProgress?.submitted ?? 0;
  const submittedAll = !!session && total > 0 && done >= total;

  return (
    <div>
      {session && inProgress && (
        <div className="card home-card resume">
          <div>
            <div className="resume-title">{submittedAll ? "Paper submitted, waiting to be marked" : `${session.mode === "exam" ? "Exam" : "Practice"} in progress`}</div>
            <div className="muted">
              {total} question{total === 1 ? "" : "s"}
              {session.mode === "practice" ? `, ${done} submitted` : `, ${Math.max(done, inProgress.answered)} answered`}
              {left !== null && !submittedAll ? `, ${formatDuration(left)} left on the clock` : ""}
              {submittedAll ? "" : ", saved where you left it"}
            </div>
          </div>
          <span style={{ flex: 1 }} />
          {submittedAll ? (
            <button className="primary" onClick={() => nav(`/session/${session.id}`)}>Mark</button>
          ) : (
            <button className="primary" onClick={() => nav("/paper")}>Continue</button>
          )}
          <button onClick={() => void discardSession()} title={session.mode === "practice" && done > 0 ? "Submitted questions stay answered" : undefined}>Discard</button>
        </div>
      )}
      <div className="card home-card">
        <div className="row spread">
          <div className="seg">
            {(["week", "year", "overall"] as Range[]).map((r) => (
              <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
                {r === "week" ? "Week" : r === "year" ? "Year" : "Overall"}
              </button>
            ))}
          </div>
        </div>
        <Heatmap grid={view.grid} />
        <div className="stat-row">
          <div><div className="stat-value">{summary.answered}</div><div className="stat-label">answered</div></div>
          <div><div className="stat-value">{summary.correctPct === null ? "—" : `${summary.correctPct}%`}</div><div className="stat-label">score</div></div>
          <div><div className="stat-value">{summary.dailyAvg}</div><div className="stat-label">daily avg</div></div>
          <div><div className="stat-value">{summary.secondsPerQuestion === null ? "—" : formatDuration(summary.secondsPerQuestion)}</div><div className="stat-label">per question</div></div>
        </div>
      </div>

      <div className="card home-card" style={{ marginTop: "1.2rem" }}>
        <h1 style={{ fontSize: "1.05rem", marginBottom: "0.8rem" }}>New session</h1>
        <div className="row">
          <input type="search" placeholder="Search presentations" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: "12rem" }} />
          <label className="check"><input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} /> New questions only</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as "practice" | "exam")}>
            <option value="practice">Practice</option>
            <option value="exam">Exam</option>
          </select>
        </div>

        <div className="pres-list">
          <label className="pres-row head">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(withQuestions.map((p) => p.id)))} />
            <span className="name">All presentations</span>
            <span className="bar" />
            <span className="count muted">{[...progress.values()].reduce((a, p) => a + p.marked, 0)} / {data.questions.length}</span>
          </label>
          {visible.map((p) => {
            const pr = progress.get(p.id)!;
            const markedPct = pr.total ? (100 * pr.marked) / pr.total : 0;
            const attemptedPct = pr.total ? (100 * (pr.attempted - pr.marked)) / pr.total : 0;
            return (
              <label key={p.id} className={"pres-row" + (p.parent ? " child" : "") + (pr.total === 0 ? " none" : "")}>
                <input type="checkbox" checked={selected.has(p.id)} disabled={pr.total === 0} onChange={() => toggle(p.id)} />
                <span className="name"><span className="emoji">{p.emoji}</span>{p.name}</span>
                <span className="bar">
                  <span className="fill marked" style={{ width: `${markedPct}%` }} />
                  <span className="fill attempted" style={{ width: `${attemptedPct}%` }} />
                </span>
                <span className="count muted">{pr.marked} / {pr.total}</span>
              </label>
            );
          })}
        </div>

        <div className="row" style={{ marginTop: "1rem" }}>
          <span className="muted">{selected.size ? `${pool.length} question${pool.length === 1 ? "" : "s"} available` : "Select presentations to study"}</span>
          <span style={{ flex: 1 }} />
          <input type="number" min={1} placeholder={String(pool.length || "")} value={count} onChange={(e) => setCount(e.target.value)} title="How many questions, random pick. Blank for all." />
          <span className="muted">questions</span>
          <input type="number" min={0} placeholder={String(suggestedMinutes)} value={minutes} onChange={(e) => setMinutes(e.target.value)} title="Minutes. 0 for no timer." />
          <span className="muted">min</span>
          <button className="primary" onClick={start} disabled={pool.length === 0}>{mode === "exam" ? "Start exam" : "Start practice"}</button>
        </div>
      </div>
    </div>
  );
}
