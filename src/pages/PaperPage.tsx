import { loadLibrary, readCatalogue } from "../lib/library";
import { prefetchSet, syncFromBank } from "../lib/bank";
import { useSetContent } from "../lib/useSetContent";
import { hasAnswerContent } from "../lib/answerContent";
import QuestionCommunity from "../components/QuestionCommunity";
import ShareLinks from "../components/ShareLinks";
import AmbossSearch from "../components/AmbossSearch";
import { useLiveQuery } from "dexie-react-hooks";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { db, newId } from "../data/db";
import type { Attempt, PartAnswer, Question, Session } from "../data/types";
import Editor from "../components/Editor";
import { answerParts, formatClock, partLabel, stemsOf } from "../lib/questions";
import { loadSession, pauseSession, resumeSession, saveSession } from "../lib/session";
import { recoverAnswerDrafts, writeAnswerDraft, clearAnswerDraft } from "../lib/answerDrafts";
import { canWriteAnswers, readingRemainingSec, overtimeSec, remainingSec, shouldAutoSubmit } from "../lib/sessionClock";
import AmbossText from "../components/AmbossText";
import QuickEdit from "../components/QuickEdit";
import SetMarking from "../components/SetMarking";
import AccountGate from "../components/AccountGate";
import FixWithClaude from "../components/FixWithClaude";
import { useAccountGate } from "../lib/accountGate";
import { isAdmin } from "../lib/admin";
import { selectionOffsets, toggleRange, type Range } from "../lib/highlights";
import { getSettings } from "../data/db";
import { questionRef, recordDeletes, requestSync } from "../lib/sync";
import { belongsToAccount } from "../lib/progressAccount";
import SessionSidebar from "../components/SessionSidebar";
import { openedSetCount, paperQuestionGroup, sessionAtQuestion, sessionSetGroups } from "../lib/sessionNavigation";
import { setLabel } from "../lib/sets";

export default function PaperPage() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const ownerRef = useRef(session?.ownerId ?? "");
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const gate = useAccountGate();
  const [gateOpen, setGateOpen] = useState(false);
  const [submittingSet, setSubmittingSet] = useState(false);
  const [saveError, setSaveError] = useState("");
  const imageJobs = useRef(new Set<string>());
  const [addingImages, setAddingImages] = useState(false);
  const onImageBusy = (key: string, busy: boolean) => {
    if (busy) imageJobs.current.add(key); else imageJobs.current.delete(key);
    setAddingImages(imageJobs.current.size > 0);
  };
  const [activePart, setActivePart] = useState<string>(() => session?.activePart ?? "");
  const elapsedRef = useRef<Map<string, number>>(new Map());
  const answersRef = useRef<Map<string, PartAnswer[]>>(new Map());
  const flushTimers = useRef<Map<string, number>>(new Map());
  const submittingRef = useRef(false);
  const [stemPct, setStemPct] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("saq-stem-pct"));
      return v >= 20 && v <= 80 ? v : 50;
    } catch {
      return 50;
    }
  });
  const splitRef = useRef<HTMLDivElement>(null);
  const stemRef = useRef<HTMLDivElement>(null);
  const highlightsRef = useRef<Map<string, Attempt["stemHighlights"]>>(new Map());
  const [, bump] = useState(0);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const box = splitRef.current?.getBoundingClientRect();
    if (!box) return;
    const move = (ev: PointerEvent) => {
      const pct = Math.min(80, Math.max(20, ((ev.clientX - box.left) / box.width) * 100));
      setStemPct(pct);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setStemPct((v) => {
        try { localStorage.setItem("saq-stem-pct", String(Math.round(v))); } catch { /* ignore */ }
        return v;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Create attempts for the session's questions if they do not exist yet.
  useEffect(() => {
    if (!session) {
      nav("/home", { replace: true });
      return;
    }
    (async () => {
      // Questions deleted since the paper was started drop out of it.
      await recoverAnswerDrafts(session.id);
      if (!await readCatalogue()) await syncFromBank().catch(() => undefined);
      const library = await loadLibrary();
      const byId = new Map(library.questions.map(q => [q.id, q]));
      const found = session.questionIds.map(id => byId.get(id));
      const keep = session.questionIds.map((_, i) => !!found[i]);
      let current = session;
      if (keep.some((k) => !k)) {
        const questionIds = session.questionIds.filter((_, i) => keep[i]);
        const gone = session.attemptIds.filter((id, i) => id && !keep[i]);
        if (gone.length) {
          await db.attempts.bulkDelete(gone);
          await recordDeletes("attempts", gone);
        }
        if (questionIds.length === 0) {
          saveSession(null, ownerRef.current);
          nav("/home", { replace: true });
          return;
        }
        current = {
          ...session,
          questionIds,
          attemptIds: session.attemptIds.filter((_, i) => keep[i]),
          index: Math.min(session.index, questionIds.length - 1),
        };
      }
      // A session adopted from another device may name attempts that have not arrived yet.
      const present = new Set((await db.attempts.bulkGet(current.attemptIds.filter(Boolean))).filter((a): a is Attempt => !!a && belongsToAccount(a, ownerRef.current)).map((a) => a.id));
      if (current.attemptIds.some((id) => id && !present.has(id))) {
        current = { ...current, attemptIds: current.attemptIds.map((id) => (present.has(id) ? id : "")) };
      }
      // Idempotent: reuse any attempt already created for this session and question
      // (StrictMode runs this effect twice in development).
      const refs = new Map<string, Awaited<ReturnType<typeof questionRef>>>();
      for (const q of found) if (q) refs.set(q.id, await questionRef(q, library.sets.find(s => s.id === q.setId)));
      const ids = await db.transaction("rw", db.attempts, async () => {
        const existing = await db.attempts.where("sessionId").equals(current.id).filter((a) => belongsToAccount(a, ownerRef.current)).toArray();
        const result = [...current.attemptIds];
        for (let i = 0; i < current.questionIds.length; i++) {
          if (result[i]) continue;
          const found = existing.find((a) => a.questionId === current.questionIds[i] && !result.includes(a.id));
          if (found) {
            result[i] = found.id;
            continue;
          }
          const a: Attempt = {
            id: newId(),
            ownerId: ownerRef.current,
            questionId: current.questionIds[i],
            qref: refs.get(current.questionIds[i]),
            answers: [],
            startedAt: Date.now(),
            elapsedSec: 0,
            timerLimitSec: current.totalSec,
            mode: current.mode,
            sessionId: current.id,
          };
          await db.attempts.add(a);
          existing.push(a);
          result[i] = a.id;
        }
        return result;
      });
      if (current !== session || ids.join(",") !== current.attemptIds.join(",")) {
        // Keep the clock state the resume effect may have written meanwhile.
        const clock = loadSession(ownerRef.current);
        const next = { ...current, startedAt: clock?.startedAt ?? current.startedAt, pausedAt: clock?.pausedAt, attemptIds: ids };
        saveSession(next);
        setSession(next);
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prefs = useLiveQuery(async () => {
    const settings = await getSettings();
    return { ambossOnPaper: settings.ambossOnPaper, admin: isAdmin(settings) };
  }, []);
  const ambossOnPaper = session?.examFormat ? false : prefs?.ambossOnPaper ?? false;
  const admin = !session?.examFormat && (prefs?.admin ?? false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [editingMode, setEditingMode] = useState<"stem" | "question">("question");

  const data = useLiveQuery(async () => {
    if (!session || !ready) return undefined;
    const library = await loadLibrary();
    const byId = new Map(library.questions.map(q => [q.id, q]));
    const questions = session.questionIds.map(id => byId.get(id));
    const attempts = await db.attempts.bulkGet(session.attemptIds);
    // Never pair an answer with another question while a replacement/deletion is arriving.
    if (questions.some((q) => !q) || attempts.length !== questions.length || attempts.some((a) => !a || !belongsToAccount(a, ownerRef.current))) return undefined;
    const sets = library.sets;
    const marks = await db.marks.where("attemptId").anyOf(session.attemptIds.filter(Boolean)).filter((m) => belongsToAccount(m, ownerRef.current)).toArray();
    return {
      questions: questions.filter((q): q is Question => !!q),
      attempts: attempts.filter((a): a is Attempt => !!a && belongsToAccount(a, ownerRef.current)),
      sets, marks, pending: library.pending,
    };
  }, [session?.id, ready, session?.attemptIds.join(",")]);

  // Seed local answer cache from the database once.
  useEffect(() => {
    if (!data) return;
    for (const a of data.attempts) {
      if (!answersRef.current.has(a.id)) answersRef.current.set(a.id, a.answers);
      if (!elapsedRef.current.has(a.id)) elapsedRef.current.set(a.id, a.elapsedSec);
      if (!highlightsRef.current.has(a.id)) highlightsRef.current.set(a.id, a.stemHighlights ?? []);
    }
  }, [data]);

  const index = session?.index ?? 0;
  const question = data?.questions[index];
  const attempt = data?.attempts[index];
  const content = useSetContent(question?.setId, data?.sets.find(s => s.id === question?.setId)?.bankUpdatedAt);
  useEffect(() => {
    if (!content.ready || !data || !question) return;
    const next = data.questions.slice(index + 1).find(q => q.setId !== question.setId);
    prefetchSet(next?.setId);
  }, [content.ready, question?.setId, data?.questions.map(q => q.id).join(",")]);
  const remaining = session ? remainingSec(session, now) : null;
  const readingLeft = session ? readingRemainingSec(session, now) : 0;
  const reading = readingLeft > 0;
  const displayedRemaining = reading ? readingLeft : remaining;
  const expired = remaining !== null && remaining <= 0;
  const examExpired = !!session && shouldAutoSubmit(session, now);

  const flushAttempt = useCallback(async (attemptId: string) => {
    const answers = answersRef.current.get(attemptId);
    const elapsedSec = elapsedRef.current.get(attemptId);
    const patch: Partial<Attempt> = {};
    if (answers) patch.answers = answers;
    const hl = highlightsRef.current.get(attemptId);
    if (hl) patch.stemHighlights = hl;
    if (elapsedSec !== undefined) patch.elapsedSec = elapsedSec;
    await db.attempts.update(attemptId, patch);
    if (answers) clearAnswerDraft(attemptId, answers);
  }, []);

  /** Write every cached answer, highlight and elapsed time of the paper to the database. */
  const flushAll = useCallback(() => {
    for (const t of flushTimers.current.values()) clearTimeout(t);
    flushTimers.current.clear();
    const s = sessionRef.current;
    if (!s) return;
    for (const id of s.attemptIds) if (id && answersRef.current.has(id)) void flushAttempt(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back to the paper restarts the exam clock; leaving it (another page,
  // marking, closing the tab) saves everything and stops the clock.
  useEffect(() => {
    const resumed = resumeSession(ownerRef.current);
    if (resumed) setSession(resumed);
    const leave = () => {
      flushAll();
      pauseSession(ownerRef.current);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [flushAll]);


  // Clock: ticks the display and the active attempt's elapsed time.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (attempt && !attempt.submittedAt && sessionRef.current && canWriteAnswers(sessionRef.current, Date.now())) {
        elapsedRef.current.set(attempt.id, (elapsedRef.current.get(attempt.id) ?? 0) + 1);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [attempt]);

  // Periodic flush of elapsed time.
  useEffect(() => {
    const t = setInterval(() => {
      if (attempt) void flushAttempt(attempt.id);
    }, 5000);
    return () => clearInterval(t);
  }, [attempt, flushAttempt]);

  const submitAll = useCallback(async () => {
    if (!session || !data || readingRemainingSec(session, Date.now()) > 0 || submittingRef.current || imageJobs.current.size) return;
    submittingRef.current = true;
    for (const a of data.attempts) {
      await flushAttempt(a.id);
      if (!a.submittedAt) await db.attempts.update(a.id, { submittedAt: Date.now() });
    }
    requestSync(0);
    nav(`/session/${session.id}`, { replace: true });
  }, [session, data, flushAttempt, nav]);

  // Closing the tab mid-exam is possible but gets a warning; the exam resumes on return.
  useEffect(() => {
    if (session?.mode !== "exam") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [session?.mode]);

  // Only exams submit at the deadline. Practice remains editable after time runs out.
  useEffect(() => {
    if (examExpired && data && !submittingRef.current) void submitAll();
  }, [examExpired, data, submitAll, addingImages]);

  const onAnswerChange = (attemptId: string, label: string, doc: unknown, text: string) => {
    if (!sessionRef.current || !canWriteAnswers(sessionRef.current, Date.now())) return;
    const current = answersRef.current.get(attemptId) ?? [];
    const existing = current.find((x) => x.label === label);
    const wasAnswered = hasAnswerContent(existing);
    if (wasAnswered !== hasAnswerContent({ doc, text })) bump((n) => n + 1);
    const next = existing
      ? current.map((x) => (x.label === label ? { ...x, doc, text } : x))
      : [...current, { label, doc, text }];
    answersRef.current.set(attemptId, next);
    if (session) writeAnswerDraft(session.id, attemptId, next);
    const prev = flushTimers.current.get(attemptId);
    if (prev) clearTimeout(prev);
    flushTimers.current.set(attemptId, window.setTimeout(() => void flushAttempt(attemptId).then(() => requestSync()), 600));
  };

  const toggleFlag = async (attemptId: string, label: string) => {
    const current = answersRef.current.get(attemptId) ?? [];
    const existing = current.find((x) => x.label === label);
    const next = existing
      ? current.map((x) => (x.label === label ? { ...x, flagged: !x.flagged } : x))
      : [...current, { label, doc: null, text: "", flagged: true }];
    answersRef.current.set(attemptId, next);
    if (session) writeAnswerDraft(session.id, attemptId, next);
    await flushAttempt(attemptId);
    requestSync();
  };

  /** Make question i current (without scrolling), e.g. when one of its answer boxes gets focus. */
  const setCurrent = (i: number, label = "") => {
    if (!session) return;
    setActivePart(label);
    if (session.index === i && session.activePart === label) return;
    if (attempt) void flushAttempt(attempt.id);
    const next = sessionAtQuestion(session, data?.questions ?? [], i, label);
    saveSession(next);
    setSession(next);
    requestSync();
  };

  /** Highlight (or un-highlight) the selected text in the stem column, stored on the current attempt. */
  const highlightSelection = useCallback(() => {
    if (!attempt || !stemRef.current) return;
    const sel = window.getSelection();
    const anchor = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
    const block = anchor?.closest<HTMLElement>("[data-stem]");
    if (!block || !stemRef.current.contains(block)) return;
    const offsets = selectionOffsets(block);
    if (!offsets) return;
    const stem = Number(block.dataset.stem);
    const existing = highlightsRef.current.get(attempt.id) ?? [];
    const own = existing.filter((h) => h.stem === stem).map((h) => ({ start: h.start, end: h.end }));
    const next: Range[] = toggleRange(own, offsets);
    highlightsRef.current.set(attempt.id, [...existing.filter((h) => h.stem !== stem), ...next.map((r) => ({ stem, ...r }))]);
    sel?.removeAllRanges();
    bump((n) => n + 1);
    void flushAttempt(attempt.id).then(() => requestSync());
  }, [attempt, flushAttempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "h") {
        const sel = window.getSelection();
        const node = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
        if (node && stemRef.current?.contains(node)) {
          e.preventDefault();
          highlightSelection();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [highlightSelection]);

  const restoredPosition = useRef(false);
  useEffect(() => {
    if (!data || restoredPosition.current) return;
    restoredPosition.current = true;
    const frame = requestAnimationFrame(() => {
      const saved = sessionRef.current;
      if (saved) document.getElementById(`part-${saved.index}-${saved.activePart || "q"}`)?.scrollIntoView({ block: "start" });
    });
    return () => { cancelAnimationFrame(frame); restoredPosition.current = false; };
  }, [!!data]);

  // Marking a submitted set is not writing time: the practice clock stops until the next set opens.
  const submittedKey = data?.attempts.map((a) => a.submittedAt ?? 0).join(",");
  useEffect(() => {
    if (!session || !data || session.mode !== "practice") return;
    const groups = sessionSetGroups(session, data.questions);
    const current = groups.find((g) => g.indices.includes(session.index));
    const marking = !!current && current.indices.every((i) => data.attempts[i]?.submittedAt !== undefined);
    if (marking) { pauseSession(ownerRef.current); const paused = loadSession(ownerRef.current); if (paused) setSession(paused); }
    else { const resumed = resumeSession(ownerRef.current); if (resumed) setSession(resumed); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.mode, session?.index, submittedKey]);

  const goTo = (i: number, label = "") => {
    if (imageJobs.current.size) return;
    if (gate.gated && session && data) {
      // A guest may finish the set they are in; the next one needs an account.
      const groups = sessionSetGroups(session, data.questions);
      const target = groups.findIndex((g) => g.indices.includes(i));
      if (target >= openedSetCount(session, groups)) { setGateOpen(true); return; }
    }
    setSummaryOpen(false);
    setCurrent(i, label);
    setTimeout(() => document.getElementById(`part-${i}-${label || "q"}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
  };

  if (!session || !data || !question || !attempt) return <p role="status">Loading session…</p>;
  if (!content.ready || data.pending.has(question.setId)) return <div role="status"><p>{content.error || "Loading set…"}</p>{content.error && <button onClick={content.retry}>Retry</button>}<button onClick={() => nav("/home")}>Save & exit</button></div>;
  const unsubmitted = data.attempts.filter((a) => !a.submittedAt).length;
  const setMode = session.studyUnit === "sets";
  const setGroups = sessionSetGroups(session, data.questions);
  const setIndex = setGroups.findIndex((group) => group.indices.includes(index));
  const openedGroups = setGroups.slice(0, openedSetCount(session, setGroups));
  const marked = new Set(data.marks.map((m) => m.attemptId));
  const currentSet = setGroups[setIndex];
  const lastInSet = currentSet.indices[currentSet.indices.length - 1];
  const setSubmitted = currentSet.indices.every((i) => data.attempts[i].submittedAt !== undefined);
  const firstToMark = currentSet.indices.find((i) => !marked.has(data.attempts[i].id)) ?? currentSet.indices[0];
  const submitSet = async () => {
    if (submittingRef.current || setSubmitted || imageJobs.current.size) return;
    submittingRef.current = true;
    setSubmittingSet(true); setSaveError("");
    try {
      for (const i of currentSet.indices) await flushAttempt(data.attempts[i].id);
      const submittedAt = Date.now();
      await db.transaction("rw", db.attempts, async () => {
        for (const i of currentSet.indices) {
          if (data.attempts[i].submittedAt === undefined) await db.attempts.update(data.attempts[i].id, { submittedAt });
        }
      });
      requestSync(0);
    } catch { setSaveError("Could not submit this set. Your draft answers are still here; please try again."); }
    finally { submittingRef.current = false; setSubmittingSet(false); }
  };
  const nextQuestion = (i: number) => {
    if (imageJobs.current.size) return;
    if (i + 1 < data.questions.length) goTo(i + 1);
    else { flushAll(); setSummaryOpen(true); }
  };

  // Questions that share the same stems sit on one scrolling page.
  const groupIndices = paperQuestionGroup(data.questions, index, stemsOf);
  const stems = stemsOf(question);
  const questionNumber = (i: number) => i + 1;
  const groupLabel = groupIndices.length > 1 ? `${questionNumber(groupIndices[0])}–${questionNumber(groupIndices[groupIndices.length - 1])}` : `${questionNumber(index)}`;
  const stemTexts = [...stems, ...groupIndices.flatMap((i) => [data.questions[i].text, ...data.questions[i].parts.map((x) => x.text)])];
  // Without stems, a question with parts uses its own text as the stem (older paste format).
  const legacyStemDoc = stems.length === 0 && question.parts.length > 0 ? question.textDoc : undefined;
  const legacyStem = stems.length === 0 && question.parts.length > 0 ? question.text : null;
  // Highlights made while any question of this group was current apply to the shared stems.
  const groupHighlights = (stem: number): Range[] =>
    groupIndices.flatMap((i) => (highlightsRef.current.get(data.attempts[i].id) ?? []).filter((h) => h.stem === stem));

  return (
    <>
      <div className="paper-top">
        <span className="paper-status">
          <span className="paper-mode">{session.mode === "exam" ? "Exam" : "Practice"}</span>
          {setMode && setGroups.length > 1 && <span>Set {setIndex + 1} of {setGroups.length}</span>}
          <span>{setMode ? `Question ${questionNumber(index)}` : `Question ${index + 1} of ${data.questions.length}`}</span>
        </span>
        {displayedRemaining !== null && (expired && session.mode === "practice"
          ? <span className="timer over" aria-label="Practice overtime"><small>Over time</small>{formatClock(overtimeSec(session, now))}</span>
          : <span className={"timer" + (displayedRemaining <= 60 ? " low" : "")} aria-label={reading ? "Reading time remaining" : "Writing time remaining"}>{(reading || session.examFormat) && <small>{reading ? "Reading" : "Writing"}</small>}{formatClock(displayedRemaining)}</span>
        )}
        <span style={{ flex: 1 }} />
        {session.mode === "practice" && !session.examFormat && <AmbossSearch />}
        {!session.examFormat && <ShareLinks key={question.id} set={data.sets.find(s => s.id === question.setId)} />}
        {session.mode !== "exam" && <button disabled={addingImages} onClick={() => nav("/home")}>{session.examFormat ? "Exit" : "Save & exit"}</button>}
        <button disabled={addingImages} onClick={() => { flushAll(); setSummaryOpen((open) => !open); }} aria-pressed={summaryOpen}>Summary</button>
        {session.mode === "practice"
          ? <button onClick={() => nextQuestion(index)} disabled={submittingSet || addingImages}>{index + 1 >= data.questions.length ? "Session summary" : data.questions[index + 1].setId !== data.questions[index].setId ? "Next set" : "Next"}</button>
          : <button className="primary" onClick={submitAll} disabled={reading || expired || addingImages}>Submit paper ({unsubmitted} left)</button>}

      </div>
      {reading && <div className="practice-time-notice" role="status">Reading time. Answers unlock automatically when writing begins.</div>}
      {expired && session.mode === "practice" && <div className="practice-time-notice" role="status">Suggested time reached. Keep writing and submit when you're ready.</div>}
      {addingImages && <div className="practice-time-notice" role="status">Adding pictures…</div>}
      {saveError && <div className="practice-time-notice" role="alert">{saveError}</div>}
      <div className="paper">
        <SessionSidebar session={session} questions={data.questions} attempts={data.attempts} activePart={activePart} summaryOpen={summaryOpen} onQuestion={goTo} />
        {summaryOpen ? <section className="paper-summary" aria-label="Session summary">
          <h1>Session summary</h1><p className="muted">{data.attempts.length - unsubmitted} of {data.questions.length} questions submitted. {data.marks.length} marked.</p>
          {(setMode ? openedGroups : setGroups).map((group, number) => {
            const set = data.sets.find((s) => s.id === group.setId);
            const submitted = group.indices.filter((i) => data.attempts[i].submittedAt !== undefined);
            const unmarked = submitted.find((i) => !marked.has(data.attempts[i].id));
            return <div className="session-summary-row" key={group.setId}><div><strong>{setMode ? `${number + 1}. ` : ""}{set ? setLabel(set) : "Set"}</strong>{set && set.name !== setLabel(set) && <p>{set.name}</p>}<span className="muted">{submitted.length} / {group.indices.length} submitted, {group.indices.filter((i) => marked.has(data.attempts[i].id)).length} marked</span></div><div className="row"><button onClick={() => goTo(group.indices[0])}>Open set</button>{session.mode === "practice" && submitted.length > 0 && <button onClick={() => nav(`/mark/${data.attempts[unmarked ?? submitted[0]].id}`)}>{unmarked !== undefined ? "Mark set" : "Review"}</button>}</div></div>;
          })}
          {setMode && openedGroups.length < setGroups.length && <p className="muted">{setGroups.length - openedGroups.length} sets still to open.</p>}
          <div className="row"><button onClick={() => setSummaryOpen(false)}>Back to question</button>{setMode && openedGroups.length < setGroups.length && <button className="primary" onClick={() => goTo(setGroups[openedGroups.length].indices[0])}>Open next set</button>}{unsubmitted === 0 && <button className="primary" onClick={() => nav(`/session/${session.id}`)}>Finish session</button>}</div>
        </section> : session.mode === "practice" && setSubmitted ? <SetMarking key={currentSet.setId} attemptId={data.attempts[firstToMark].id} embedded
          partId={(questionId, label) => `part-${data.questions.findIndex((q) => q.id === questionId)}-${label || "q"}`}
          onAdvance={() => { if (setIndex + 1 < setGroups.length) goTo(setGroups[setIndex + 1].indices[0]); else { flushAll(); setSummaryOpen(true); } }} /> : <div className="paper-split" ref={splitRef}>
        <div className="paper-stem" style={{ flexBasis: `${stemPct}%` }} ref={stemRef}>
          <div className="col-head">
            <span>{groupLabel}</span>
            <span style={{ flex: 1 }} />
            {admin && <button className="small hl-btn" onClick={() => { setEditingMode("stem"); setEditing(question); }}>Edit case stem</button>}
            <button className="small hl-btn" onMouseDown={(e) => e.preventDefault()} onClick={highlightSelection} title="Highlight the selected text (⌘⇧H). Select highlighted text and press again to remove.">Highlight</button>
          </div>
          {stems.map((st, si) => (
            <div key={si} className={"stem-block" + (si > 0 && si === stems.length - 1 ? " revealed" : "")}>
              {si > 0 && <div className="stem-more">More information</div>}
              <AmbossText cacheKey={question.id} texts={stemTexts} text={st} doc={question.stemDocs?.[si]} disabled={!ambossOnPaper} highlights={groupHighlights(si)} dataStem={si} />
            </div>
          ))}
          {(legacyStem || legacyStemDoc) ? <AmbossText cacheKey={question.id} texts={stemTexts} text={legacyStem ?? ""} doc={legacyStemDoc} disabled={!ambossOnPaper} highlights={groupHighlights(0)} dataStem={0} /> : null}
          {groupIndices.flatMap((i) => (data.questions[i].images ?? []).filter((im) => im.place === "stem")).map((im) => (
            <figure key={im.id} className="qimg"><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption className="muted">{im.caption}</figcaption>}</figure>
          ))}
          {stems.length === 0 && !legacyStem && !legacyStemDoc && <div className="muted">No case stem.</div>}
        </div>
        <div className="paper-handle" onPointerDown={startDrag} title="Drag to resize" />
        <div className="paper-answers">
          <div className="col-head">{reading ? "Questions" : "Answer"}</div>
          {groupIndices.map((qi) => {
            const q = data.questions[qi];
            const a = data.attempts[qi];
            const locked = !!a.submittedAt || reading || examExpired;
            const cachedAnswers = answersRef.current.get(a.id) ?? a.answers;
            const parts = answerParts(q);
            const showText = stemsOf(q).length > 0 || q.parts.length === 0;
            return (
              <div key={q.id} className={"question-block" + (qi === index ? " current" : "")} id={`part-${qi}-q`}
                onMouseDownCapture={(event) => { if (!(event.target as Element).closest("button,a,input,select") && qi !== index) setCurrent(qi); }}>
                {(
                  <div className="qhead">
                    <span>{groupIndices.length > 1 ? questionNumber(qi) : ""}</span>
                    <span style={{ flex: 1 }} />
                    {a.submittedAt && <span className="muted">submitted</span>}
                    <QuestionCommunity question={q} set={data.sets.find(s => s.id === q.setId)} disabled={session.mode === "exam" && unsubmitted > 0} />
                    {admin && <FixWithClaude set={data.sets.find(s => s.id === q.setId)} question={q} />}
                    {admin && <button className="small" onClick={() => { setEditingMode("question"); setEditing(q); }} title="Edit this question (admin)">Edit question</button>}
                  </div>
                )}
                {showText && (
                  <div className="part-head" style={{ marginBottom: "0.8rem" }}>
                    <AmbossText cacheKey={q.id} texts={stemTexts} text={q.text} doc={q.textDoc} className="text" disabled={!ambossOnPaper} />
                    {q.parts.length === 0 && q.marks !== undefined && <span className="marks">({q.marks} mark{q.marks === 1 ? "" : "s"})</span>}
                  </div>
                )}
                {(q.images ?? []).filter((im) => im.place === "question").map((im) => (
                  <figure key={im.id} className="qimg"><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption className="muted">{im.caption}</figcaption>}</figure>
                ))}
                {parts.map((p) => {
                  const ans = cachedAnswers.find((x) => x.label === p.label);
                  return (
                    <div key={`${a.id}-${p.label}`} className="part" id={`part-${qi}-${p.label || "q"}`}>
                      <div className="part-head">
                        {p.label && <span className="label">{partLabel(p.label)}</span>}
                        <AmbossText cacheKey={q.id} texts={stemTexts} text={p.text} doc={p.textDoc} className="text" disabled={!ambossOnPaper} />
                        {q.parts.length > 0 && p.marks !== undefined && <span className="marks">({p.marks} mark{p.marks === 1 ? "" : "s"})</span>}
                        <button className={"small" + (ans?.flagged ? " active" : "")} title="Flag for review" onClick={() => toggleFlag(a.id, p.label)}>⚑</button>
                      </div>
                      {!reading && <Editor
                        initial={ans?.doc}
                        locked={locked}
                        onChange={(doc, text) => onAnswerChange(a.id, p.label, doc, text)}
                        onFocus={() => setCurrent(qi, p.label)}
                        onBusyChange={(busy) => onImageBusy(`${a.id}:${p.label}`, busy)}
                      />}
                    </div>
                  );
                })}
                <div className="row question-actions">
                  {session.mode === "practice" && qi === lastInSet && (setSubmitted ? <>
                    <span className="muted" role="status">Set submitted</span>
                    <button onClick={() => { flushAll(); nav(`/mark/${data.attempts[firstToMark].id}`); }}>
                      {currentSet.indices.every((i) => marked.has(data.attempts[i].id)) ? "Review marking" : "Mark set"}
                    </button>
                  </> : <button className="primary" onClick={() => void submitSet()} disabled={submittingSet || addingImages}>
                    {submittingSet ? "Submitting…" : "Submit set"}
                  </button>)}
                  <button onClick={() => nextQuestion(qi)} disabled={submittingSet || addingImages}>{qi + 1 < data.questions.length ? qi === lastInSet ? "Next set" : "Next" : "Session summary"}</button>
                </div>
              </div>
            );
          })}

        </div>
        </div>}
      </div>
      <AccountGate open={gateOpen} guestSubmitted={gate.guestSubmitted} onClose={() => setGateOpen(false)} />
      {editing && (
        <QuickEdit
          question={editing}
          mode={editingMode}
          onClose={() => setEditing(null)}
          onDeleted={() => { setEditing(null); const current = loadSession(ownerRef.current); setSession(current); if (!current) nav("/home"); }}

        />
      )}
    </>
  );
}
