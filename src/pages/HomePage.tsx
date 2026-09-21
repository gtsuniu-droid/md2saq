import AttemptHistory from "../components/AttemptHistory";
import { belongsToAccount } from "../lib/progressAccount";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { db, getSettings } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import Heatmap from "../components/Heatmap";
import { formatDuration, truncate, stemsOf } from "../lib/questions";
import { discardSession, startSession } from "../lib/session";
import { remainingSec } from "../lib/sessionClock";
import { useSession } from "../lib/useSession";
import { answeredPerDay, heatGrid, presentationProgress, summarise } from "../lib/stats";

import { buildSessionSelection, eligibleSessionSets, seededRandom, suggestedSessionMinutes, type StudyUnit } from "../lib/sessionBuilder";
import { setLabel } from "../lib/sets";

type Range = "week" | "year" | "overall";
const DAY_MS = 24 * 3600 * 1000;
const PARENT_OF = new Map(PRESENTATIONS.filter((p) => p.parent).map((p) => [p.id, p.parent!]));

export default function HomePage() {
  const nav = useNavigate();
  const [range, setRange] = useState<Range>("year");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newOnly, setNewOnly] = useState(false);
  const [count, setCount] = useState("");
  const [unit, setUnit] = useState<StudyUnit>("sets");
  const [chooseSets, setChooseSets] = useState(false);
  const [selectedSets, setSelectedSets] = useState<Set<string>>(new Set());
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
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
    const [questions, attempts, marks, settings, sets] = await Promise.all([
      db.questions.toArray(),
      db.attempts.toArray(),
      db.marks.toArray(),
      getSettings(),
      db.sets.toArray(),
    ]);
    const ownerId = settings.cloudUser?.uid ?? "";
    return { questions, attempts: attempts.filter((a) => belongsToAccount(a, ownerId)), marks: marks.filter((m) => belongsToAccount(m, ownerId)), settings, sets };
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

  const selectedQuestions = useMemo(() => data ? buildSessionSelection({
    unit, sets: data.sets, questions: data.questions, attempts: data.attempts, presentations: [...selected], newOnly,
    count: count.trim() === "" ? undefined : Number(count), setIds: unit === "sets" && chooseSets ? [...selectedSets] : undefined,
    random: seededRandom(seed), parentOf: PARENT_OF,
  }) : [], [data, unit, selected, newOnly, count, chooseSets, selectedSets, seed]);

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

  const setPool = eligibleSessionSets(data.sets, data.questions, data.attempts, [...selected], newOnly, PARENT_OF);
  const allQuestions = buildSessionSelection({ unit: "questions", sets: data.sets, questions: data.questions, attempts: data.attempts, presentations: [...selected], newOnly, random: () => 0.5, parentOf: PARENT_OF });
  const poolCount = unit === "sets" ? setPool.length : allQuestions.length;
  const pickedSetIds = new Set(selectedQuestions.map((q) => q.setId));
  const suggestedMinutes = suggestedSessionMinutes(selectedQuestions, data.sets, data.settings.minutesPerMark, unit);
  const validMinutes = minutes.trim() === "" || (Number.isFinite(Number(minutes)) && Number(minutes) >= 0);
  const start = () => {
    if (!selectedQuestions.length || !validMinutes) return;
    if (session && !confirm("Start a new session and replace your unfinished paper? Submitted answers will be kept.")) return;
    const mins = minutes.trim() === "" ? suggestedMinutes : Number(minutes);
    startSession(selectedQuestions.map((q) => q.id), mode, mins > 0 ? Math.round(mins * 60) : undefined, unit);
    nav("/paper");
  };

  const left = session ? remainingSec(session, Date.now()) : null;
  const total = session?.questionIds.length ?? 0;
  const done = inProgress?.submitted ?? 0;
  const submittedAll = !!session && total > 0 && done >= total;

  return (
    <div>
      <div className="home-shortcuts"><a href="#history">History ↓</a></div>
      {session && inProgress && (
        <div className="card home-card resume">
          <div>
            <div className="resume-title">{submittedAll ? "Paper submitted, waiting to be marked" : `${session.mode === "exam" ? "Exam" : "Practice"} in progress`}</div>
            <div className="muted">
              Question {session.index + 1}{session.activePart ? ` (${session.activePart})` : ""} of {total}
              {session.mode === "practice" ? `, ${done} submitted` : `, ${Math.max(done, inProgress.answered)} answered`}
              {left !== null && !submittedAll ? session.mode === "practice" && left === 0 ? ", suggested time reached" : `, ${formatDuration(left)} left on the clock` : ""}
              {submittedAll ? "" : ", saved where you left it"}
            </div>
            <p className="muted" style={{ margin: "0.4rem 0 0" }}>{truncate(data.questions.find((q) => q.id === session.questionIds[session.index])?.text ?? "", 130)}</p>
          </div>
          <span style={{ flex: 1 }} />
          {submittedAll ? (
            <button className="primary" onClick={() => nav(`/session/${session.id}`)}>Mark</button>
          ) : (
            <button className="primary" onClick={() => nav("/paper")}>Continue session</button>
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
        <div className="session-unit-picker" role="group" aria-label="What would you like to practise?">
          <button className={unit === "questions" ? "selected" : ""} aria-pressed={unit === "questions"} onClick={() => { setUnit("questions"); setCount(""); }}><strong>Individual questions</strong><span>Mix questions from your chosen presentations.</span></button>
          <button className={unit === "sets" ? "selected" : ""} aria-pressed={unit === "sets"} onClick={() => { setUnit("sets"); setCount(""); }}><strong>Whole sets</strong><span>Complete cases, with every question in order.</span></button>
        </div>
        <div className="row">
          <input aria-label="Search presentations" type="search" placeholder="Search presentations" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: "12rem" }} />
          <label className="check"><input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} /> {unit === "sets" ? "Unattempted sets only" : "Unattempted questions only"}</label>
          <select aria-label="Session mode" value={mode} onChange={(e) => setMode(e.target.value as "practice" | "exam")}>
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

        {unit === "sets" && selected.size > 0 && <div className="session-set-picker">
          <div className="row spread"><span className="muted">{setPool.length} complete sets available</span><div className="seg" role="group" aria-label="Set selection"><button className={!chooseSets ? "on" : ""} aria-pressed={!chooseSets} onClick={() => { setChooseSets(false); setCount(""); }}>Random sets</button><button className={chooseSets ? "on" : ""} aria-pressed={chooseSets} onClick={() => { setChooseSets(true); setCount(""); }}>Choose sets</button></div></div>
          {chooseSets && <div className="session-set-list">
            <div className="row"><button className="small link" onClick={() => setSelectedSets(new Set(setPool.map((s) => s.set.id)))}>Select all sets</button><button className="small link" onClick={() => setSelectedSets(new Set())}>Clear</button></div>
            {setPool.map((s) => <label key={s.set.id} className="session-set-row"><input type="checkbox" checked={selectedSets.has(s.set.id)} onChange={() => setSelectedSets((prev) => { const next = new Set(prev); if (next.has(s.set.id)) next.delete(s.set.id); else next.add(s.set.id); return next; })} /><span><strong>{setLabel(s.set)}</strong><span className="muted">{truncate(stemsOf(s.questions[0])[0] || s.questions[0].text, 110)}</span></span><small>{s.questions.length} questions · {s.attempted === 0 ? "New" : `${s.attempted} attempted`}</small></label>)}
          </div>}
          <p className="muted">All questions in each selected set are included, even if some cover another presentation.{newOnly ? " Sets with any submitted answers are excluded." : ""}</p>
        </div>}
        <div className="session-start-area">
          <div className="row">
            {!(unit === "sets" && chooseSets) && <label className="session-inline-label">How many {unit}?<input aria-label={unit === "sets" ? "Number of sets" : "Number of questions"} type="number" min={1} max={poolCount || 1} step={1} placeholder={`All (${poolCount})`} value={count} onChange={(e) => setCount(e.target.value)} /></label>}
            <label className="session-inline-label">Time (minutes)<input aria-label="Session time in minutes" type="number" min={0} step={1} placeholder={String(suggestedMinutes)} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
            <span className="muted">Leave blank for the suggested time. Enter 0 for no timer.</span>
          </div>
          <div className="session-preview" aria-live="polite">
            <div><strong>{!selected.size ? "Select presentations to begin" : !selectedQuestions.length ? "No questions selected" : unit === "sets" ? `${pickedSetIds.size} whole ${pickedSetIds.size === 1 ? "set" : "sets"} · ${selectedQuestions.length} questions` : `${selectedQuestions.length} individual ${selectedQuestions.length === 1 ? "question" : "questions"}`}</strong>
              {!!selectedQuestions.length && <p className="muted">{mode === "exam" ? "Exam" : "Practice"} · {minutes === "0" ? "Untimed" : `${minutes || suggestedMinutes} minutes`}</p>}
              {!selectedQuestions.length && selected.size > 0 && <p className="muted">{unit === "sets" && chooseSets ? "Tick the sets you want to study." : "Try changing the unattempted filter or the number requested."}</p>}
            </div>
            <div className="row">{!(unit === "sets" && chooseSets) && !!selectedQuestions.length && <button onClick={() => setSeed(Math.floor(Math.random() * 0xffffffff))}>Shuffle selection</button>}<button className="primary" onClick={start} disabled={!selectedQuestions.length || !validMinutes}>{mode === "exam" ? "Start exam" : "Start practice"}</button></div>
          </div>
          {!!selectedQuestions.length && <details className="session-selection-preview"><summary>Preview selected {unit === "sets" ? "sets" : "questions"}</summary>{[...pickedSetIds].map((id) => {
            const set = data.sets.find((s) => s.id === id);
            const qs = selectedQuestions.filter((q) => q.setId === id);
            return <div key={id}><strong>{set ? setLabel(set) : "Set"} · {qs.length} questions</strong><p className="muted">{set?.name}</p>{unit === "questions" && <ul>{qs.map((q) => <li key={q.id}>{q.text.slice(0, 150)}{q.text.length > 150 ? "…" : ""}</li>)}</ul>}</div>;
          })}</details>}
        </div>
      </div>
      <AttemptHistory key={data.settings.cloudUser?.uid ?? ""} {...data} />
    </div>
  );
}
