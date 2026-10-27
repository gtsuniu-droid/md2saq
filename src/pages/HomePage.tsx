import HomeLeaderboard from "../components/HomeLeaderboard";
import LibraryStatus from "../components/LibraryStatus";
import { loadLibrary } from "../lib/library";
import { ensureQuestionContent, ensureSetContent } from "../lib/bank";
import { buildExamPaper, examPresentationPool, EXAM_STEMS, EXAM_READING_SEC, EXAM_WRITING_SEC } from "../lib/examPaper";
import { hasAnswerContent } from "../lib/answerContent";
import AttemptHistory from "../components/AttemptHistory";
import { belongsToAccount } from "../lib/progressAccount";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { db, getSettings } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import Heatmap from "../components/Heatmap";
import ConfirmDialog from "../components/ConfirmDialog";
import AccountGate from "../components/AccountGate";
import { useAccountGate } from "../lib/accountGate";
import { formatDuration, truncate, stemsOf } from "../lib/questions";
import { discardSession, startSession } from "../lib/session";
import { readingRemainingSec, remainingSec } from "../lib/sessionClock";
import { useSession } from "../lib/useSession";
import { answeredPerDay, heatGrid, presentationProgress, summarise } from "../lib/stats";

import { buildSessionSelection, setPresentationProgress, eligibleSessionSets, seededRandom, suggestedSessionMinutes, type StudyUnit } from "../lib/sessionBuilder";
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
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [examError, setExamError] = useState("");
  const [minutes, setMinutes] = useState("");
  const [search, setSearch] = useState("");
  const [replacing, setReplacing] = useState<"practice" | "exam" | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const gate = useAccountGate();
  const [gateOpen, setGateOpen] = useState(false);
  const session = useSession();
  const inProgress = useLiveQuery(async () => {
    if (!session) return null;
    const attempts = await db.attempts.where("sessionId").equals(session.id).toArray();
    return { submitted: attempts.filter((a) => a.submittedAt !== undefined).length, answered: attempts.filter((a) => a.answers.some(hasAnswerContent)).length };
  }, [session?.id]);

  const data = useLiveQuery(async () => {
    const [{ questions, sets }, attempts, marks, settings] = await Promise.all([
      loadLibrary(),
      db.attempts.toArray(),
      db.marks.toArray(),
      getSettings(),
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
      setProgress: setPresentationProgress(data.sets, data.questions, data.attempts, data.marks, PRESENTATIONS.map((p) => p.id)),
      progress: presentationProgress(data.questions, data.attempts, data.marks, PRESENTATIONS.map((p) => p.id), PARENT_OF),
    };
  }, [data, range]);

  const selectedQuestions = useMemo(() => data ? buildSessionSelection({
    unit, sets: data.sets, questions: data.questions, attempts: data.attempts, presentations: [...selected], newOnly,
    count: count.trim() === "" ? undefined : Number(count), setIds: unit === "sets" && chooseSets ? [...selectedSets] : undefined,
    random: seededRandom(seed), parentOf: PARENT_OF,
  }) : [], [data, unit, selected, newOnly, count, chooseSets, selectedSets, seed]);

  if (!data || !view) return null;
  const { summary } = view;
  const progress = unit === "sets" ? view.setProgress.progress : view.progress;
  const allProgress = unit === "sets" ? view.setProgress.all : {
    total: data.questions.length,
    marked: new Set(data.marks.filter((m) => data.questions.some((q) => q.id === m.questionId)).map((m) => m.questionId)).size,
  };

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
  const validCount = (unit === "sets" && chooseSets) || count.trim() === "" || (Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= poolCount);
  const start = async (force = false) => {
    if (starting) return;
    if (!selectedQuestions.length || !validMinutes || !validCount) return;
    if (gate.gated) { setGateOpen(true); return; }
    if (session && !force) { setReplacing("practice"); return; }
    const mins = minutes.trim() === "" ? suggestedMinutes : Number(minutes);
    setStarting(true); setStartError("");
    try {
      await ensureSetContent(selectedQuestions[0].setId);
      startSession(selectedQuestions.map((q) => q.id), mode, mins > 0 ? Math.round(mins * 60) : undefined, unit);
      nav("/paper");
    } catch (error) { setStartError(error instanceof Error ? error.message : "Could not load the set."); }
    finally { setStarting(false); }
  };

  const examTopics = examPresentationPool(data.sets, data.questions).size;
  const startExam = async (force = false) => {
    if (starting) return;
    setExamError("");
    const paper = buildExamPaper(data.sets, data.questions);
    if (!paper.length) { setExamError("At least six presentations with sets are needed."); return; }
    if (gate.gated) { setGateOpen(true); return; }
    if (session && !force) { setReplacing("exam"); return; }
    setStarting(true);
    try {
      await ensureQuestionContent(paper.map(q => q.id));
      startSession(paper.map((q) => q.id), "exam", EXAM_WRITING_SEC, "sets", { examFormat: "six-stem", readingSec: EXAM_READING_SEC });
      nav("/paper");
    } catch (error) { setExamError(error instanceof Error ? error.message : "Could not load the exam."); }
    finally { setStarting(false); }
  };
  const readingLeft = session ? readingRemainingSec(session, Date.now()) : 0;
  const left = session ? readingLeft || remainingSec(session, Date.now()) : null;
  const total = session?.questionIds.length ?? 0;
  const done = inProgress?.submitted ?? 0;
  const submittedAll = !!session && total > 0 && done >= total;

  return (
    <div>
      <LibraryStatus /><header className="home-intro">
        <div><h1>{data.settings.cloudUser?.name ? `Welcome back, ${data.settings.cloudUser.name.split(" ")[0]}` : "Your practice"}</h1><p className="muted">Pick a presentation, sit a case, then mark it against the model answer.</p></div>
        <div className="home-shortcuts"><a href="#new-session">New session</a><a href="#history">View history</a></div>
      </header>
      {session && inProgress && (
        <div className="card home-card resume">
          <div>
            <div className="resume-title">{submittedAll ? "Paper submitted, waiting to be marked" : `${session.mode === "exam" ? "Exam" : "Practice"} in progress`}</div>
            <div className="muted">
              Question {session.index + 1}{session.activePart ? ` (${session.activePart})` : ""} of {total}
              {session.mode === "practice" ? `, ${done} submitted` : `, ${Math.max(done, inProgress.answered)} answered`}
              {left !== null && !submittedAll ? session.mode === "practice" && left === 0 ? ", suggested time reached" : `, ${formatDuration(left)} ${readingLeft ? "reading" : "writing"} time left` : ""}
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
          <button onClick={() => setDiscarding(true)}>Discard</button>
        </div>
      )}
      <div className="card home-card home-progress-card">
        <div className="row spread">
          <h2 className="section-heading">Your progress</h2>
          <div className="seg" role="group" aria-label="Progress period">
            {(["week", "year", "overall"] as Range[]).map((r) => (
              <button key={r} className={range === r ? "on" : ""} aria-pressed={range === r} onClick={() => setRange(r)}>
                {r === "week" ? "Week" : r === "year" ? "Year" : "Overall"}
              </button>
            ))}
          </div>
        </div>
        <div className="stat-row">
          <div><div className="stat-value">{summary.answered}</div><div className="stat-label">answered</div></div>
          <div><div className="stat-value">{summary.correctPct === null ? "—" : `${summary.correctPct}%`}</div><div className="stat-label">score</div></div>
          <div><div className="stat-value">{summary.dailyAvg}</div><div className="stat-label">per active day</div></div>
          <div><div className="stat-value">{summary.secondsPerQuestion === null ? "—" : formatDuration(summary.secondsPerQuestion)}</div><div className="stat-label">per question</div></div>
        </div>
        <details className="activity-details"><summary>Activity calendar</summary><Heatmap grid={view.grid} /></details>
      </div>
      <HomeLeaderboard settings={data.settings} />

      <div className="card home-card session-card" id="new-session" tabIndex={-1} aria-labelledby="new-session-heading">
        <h2 className="section-heading" id="new-session-heading">New session</h2>{startError && <p role="alert">{startError}</p>}{starting && <p role="status">Preparing questions…</p>}
        <div className="seg session-mode-picker" role="group" aria-label="Session mode">
          <button className={mode === "practice" ? "on" : ""} aria-pressed={mode === "practice"} onClick={() => setMode("practice")}>Practice</button>
          <button className={mode === "exam" ? "on" : ""} aria-pressed={mode === "exam"} onClick={() => setMode("exam")}>Exam</button>
        </div>
        {mode === "exam" ? <div className="exam-setup">
          <div className="exam-format"><div><strong>6 stems</strong><span>6 different presentations</span></div><div><strong>15 min</strong><span>Reading time</span></div><div><strong>2 hours</strong><span>Writing time</span></div></div>
          <p className="muted">Answers unlock after reading time. The clock keeps running if you leave.</p>
          {examTopics < EXAM_STEMS && <p role="status">{examTopics} of 6 presentations available. Add sets from {EXAM_STEMS - examTopics} more to start.</p>}
          {examError && <p className="field-error" role="alert">{examError}</p>}
          <button className="primary" onClick={() => void startExam()} disabled={starting || examTopics < EXAM_STEMS}>{starting ? "Preparing exam…" : "Start exam"}</button>
        </div> : <>
        <div className="session-unit-picker" role="group" aria-label="What would you like to practise?">
          <button className={unit === "sets" ? "selected" : ""} aria-pressed={unit === "sets"} onClick={() => { setUnit("sets"); setCount(""); }}><strong>Whole sets</strong><span>Complete cases, with every question in order.</span></button>
          <button className={unit === "questions" ? "selected" : ""} aria-pressed={unit === "questions"} onClick={() => { setUnit("questions"); setCount(""); }}><strong>Individual questions</strong><span>Mix questions from your chosen presentations.</span></button>
        </div>
        <div className="row">
          <input aria-label="Search presentations" type="search" placeholder="Search presentations" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: "12rem" }} />
          <label className="check"><input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} /> {unit === "sets" ? "Unattempted sets only" : "Unattempted questions only"}</label>

        </div>

        <div className="row spread presentation-list-heading"><span>Core presentations</span><span className="muted">{unit === "sets" ? "Sets" : "Questions"} marked / available</span></div>
        <div className="pres-list">
          <label className="pres-row head">
            <input type="checkbox" checked={allSelected} disabled={!withQuestions.length} onChange={() => setSelected((previous) => { const next = new Set(previous); withQuestions.forEach((p) => { if (allSelected) next.delete(p.id); else next.add(p.id); }); return next; })} />
            <span className="name">{search.trim() ? "Select all results" : "All presentations"}</span>
            <span className="bar" />
            <span className="count muted">{!search.trim() && `${allProgress.marked} / ${allProgress.total}`}</span>
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
        {visible.length === 0 && <p className="muted" role="status">No matching presentations. Try another search.</p>}
        <div className="row spread presentation-list-footer"><span className="muted">{selected.size ? `${selected.size} ${selected.size === 1 ? "presentation" : "presentations"} selected.` : "Choose one or more presentations."} Unavailable topics have no questions yet.</span>{selected.size > 0 && <button className="small link" onClick={() => setSelected(new Set())}>Clear selection</button>}</div>

        {unit === "sets" && selected.size > 0 && <div className="session-set-picker">
          <div className="row spread"><span className="muted">{setPool.length} complete {setPool.length === 1 ? "set" : "sets"} available</span><div className="seg" role="group" aria-label="Set selection"><button className={!chooseSets ? "on" : ""} aria-pressed={!chooseSets} onClick={() => { setChooseSets(false); setCount(""); }}>Random sets</button><button className={chooseSets ? "on" : ""} aria-pressed={chooseSets} onClick={() => { setChooseSets(true); setCount(""); }}>Choose sets</button></div></div>
          {chooseSets && <div className="session-set-list">
            <div className="row"><button className="small link" onClick={() => setSelectedSets(new Set(setPool.map((s) => s.set.id)))}>Select all sets</button><button className="small link" onClick={() => setSelectedSets(new Set())}>Clear</button></div>
            {setPool.map((s) => <label key={s.set.id} className="session-set-row"><input type="checkbox" checked={selectedSets.has(s.set.id)} onChange={() => setSelectedSets((prev) => { const next = new Set(prev); if (next.has(s.set.id)) next.delete(s.set.id); else next.add(s.set.id); return next; })} /><span><strong>{setLabel(s.set)}</strong><span className="muted">{truncate(stemsOf(s.questions[0])[0] || s.questions[0].text, 110)}</span></span><small>{s.questions.length} questions, {s.attempted === 0 ? "New" : `${s.attempted} attempted`}</small></label>)}
          </div>}

        </div>}
        <div className="session-start-area">
          <div className="row">
            {!(unit === "sets" && chooseSets) && <label className="session-inline-label">How many {unit}?<input aria-label={unit === "sets" ? "Number of sets" : "Number of questions"} aria-invalid={!validCount} aria-describedby={!validCount ? "session-count-error" : undefined} type="number" min={1} max={poolCount || 1} step={1} placeholder={`All (${poolCount})`} value={count} onChange={(e) => setCount(e.target.value)} /></label>}
            <label className="session-inline-label">Time (minutes)<input aria-label="Session time in minutes" aria-invalid={!validMinutes} aria-describedby={!validMinutes ? "session-time-error" : undefined} type="number" min={0} step={1} placeholder={String(suggestedMinutes)} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
            <span className="muted">Leave blank for the suggested time. Enter 0 for no timer.</span>
          </div>
          {!validCount && <p id="session-count-error" role="alert" className="field-error">{poolCount ? `Choose a whole number from 1 to ${poolCount}, or leave blank for all.` : "Select a presentation with available questions first."}</p>}
          {!validMinutes && <p id="session-time-error" role="alert" className="field-error">Enter 0 for untimed practice or a positive number of minutes.</p>}
          <p className="session-guidance muted">Practice lets you submit and mark as you go.</p>
          {!!selectedQuestions.length && <details className="session-selection-preview"><summary>Preview selected {unit === "sets" ? "sets" : "questions"}</summary>{[...pickedSetIds].map((id) => {
            const set = data.sets.find((s) => s.id === id);
            const qs = selectedQuestions.filter((q) => q.setId === id);
            return <div key={id}><strong>{set ? setLabel(set) : "Set"}, {qs.length} questions</strong><p className="muted">{set?.name}</p>{unit === "questions" && <ul>{qs.map((q) => <li key={q.id}>{q.text.slice(0, 150)}{q.text.length > 150 ? "…" : ""}</li>)}</ul>}</div>;
          })}</details>}
        </div>
          <div className="session-preview" aria-live="polite">
            <div><strong>{!selected.size ? "Select presentations to begin" : !selectedQuestions.length ? "No questions selected" : unit === "sets" ? `${pickedSetIds.size} whole ${pickedSetIds.size === 1 ? "set" : "sets"}, ${selectedQuestions.length} ${selectedQuestions.length === 1 ? "question" : "questions"}` : `${selectedQuestions.length} individual ${selectedQuestions.length === 1 ? "question" : "questions"}`}</strong>
              {!!selectedQuestions.length && <p className="muted">Practice, {minutes === "0" ? "Untimed" : `${minutes || suggestedMinutes} minutes`}</p>}
              {!selectedQuestions.length && selected.size > 0 && <p className="muted">{unit === "sets" && chooseSets ? "Tick the sets you want to study." : "Try changing the unattempted filter or the number requested."}</p>}
            </div>
            <div className="row">{!(unit === "sets" && chooseSets) && !!selectedQuestions.length && <button onClick={() => setSeed(Math.floor(Math.random() * 0xffffffff))}>Shuffle selection</button>}<button className="primary" onClick={() => void start()} disabled={starting || !selectedQuestions.length || !validMinutes || !validCount}>Start practice</button></div>
          </div>
        </>}
      </div>
      <AttemptHistory key={data.settings.cloudUser?.uid ?? ""} {...data} />

      <ConfirmDialog open={replacing !== null} title="Replace your unfinished session?" confirmLabel="Start new session" onCancel={() => setReplacing(null)} onConfirm={() => { const mode = replacing; setReplacing(null); if (mode === "exam") void startExam(true); else void start(true); }}>
        <p>You have a paper in progress. Starting a new one replaces it. Answers you already submitted are kept; unsubmitted drafts are discarded.</p>
      </ConfirmDialog>
      <AccountGate open={gateOpen} guestSubmitted={gate.guestSubmitted} onClose={() => setGateOpen(false)} />
      <ConfirmDialog open={discarding} title="Discard this session?" confirmLabel="Discard session" destructive onCancel={() => setDiscarding(false)} onConfirm={() => { setDiscarding(false); void discardSession(); }}>
        <p>Unsubmitted answers are deleted. {done > 0 ? `The ${done} submitted ${done === 1 ? "answer" : "answers"} and any marks are kept.` : "Submitted answers and marks are always kept."}</p>
      </ConfirmDialog>
    </div>
  );
}
