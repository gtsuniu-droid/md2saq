import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { db, newId } from "../data/db";
import type { Attempt, PartAnswer, Question, Session } from "../data/types";
import Editor from "../components/Editor";
import { answerParts, formatDuration, partLabel } from "../lib/questions";
import { loadSession, saveSession } from "../lib/session";

export default function PaperPage() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const [activePart, setActivePart] = useState<string>("");
  const elapsedRef = useRef<Map<string, number>>(new Map());
  const answersRef = useRef<Map<string, PartAnswer[]>>(new Map());
  const flushTimers = useRef<Map<string, number>>(new Map());
  const submittingRef = useRef(false);

  // Create attempts for the session's questions if they do not exist yet.
  useEffect(() => {
    if (!session) {
      nav("/library", { replace: true });
      return;
    }
    (async () => {
      // Idempotent: reuse any attempt already created for this session and question
      // (StrictMode runs this effect twice in development).
      const ids = await db.transaction("rw", db.attempts, async () => {
        const existing = await db.attempts.where("sessionId").equals(session.id).toArray();
        const result = [...session.attemptIds];
        for (let i = 0; i < session.questionIds.length; i++) {
          if (result[i]) continue;
          const found = existing.find((a) => a.questionId === session.questionIds[i] && !result.includes(a.id));
          if (found) {
            result[i] = found.id;
            continue;
          }
          const a: Attempt = {
            id: newId(),
            questionId: session.questionIds[i],
            answers: [],
            startedAt: Date.now(),
            elapsedSec: 0,
            timerLimitSec: session.totalSec,
            mode: session.mode,
            sessionId: session.id,
          };
          await db.attempts.add(a);
          existing.push(a);
          result[i] = a.id;
        }
        return result;
      });
      if (ids.join(",") !== session.attemptIds.join(",")) {
        const next = { ...session, attemptIds: ids };
        saveSession(next);
        setSession(next);
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = useLiveQuery(async () => {
    if (!session || !ready) return undefined;
    const questions = await db.questions.bulkGet(session.questionIds);
    const attempts = await db.attempts.bulkGet(session.attemptIds);
    return {
      questions: questions.filter((q): q is Question => !!q),
      attempts: attempts.filter((a): a is Attempt => !!a),
    };
  }, [session?.id, ready, session?.attemptIds.join(",")]);

  // Seed local answer cache from the database once.
  useEffect(() => {
    if (!data) return;
    for (const a of data.attempts) {
      if (!answersRef.current.has(a.id)) answersRef.current.set(a.id, a.answers);
      if (!elapsedRef.current.has(a.id)) elapsedRef.current.set(a.id, a.elapsedSec);
    }
  }, [data]);

  const index = session?.index ?? 0;
  const question = data?.questions[index];
  const attempt = data?.attempts[index];
  const deadline = session?.totalSec ? session.startedAt + session.totalSec * 1000 : null;
  const remaining = deadline ? Math.ceil((deadline - now) / 1000) : null;
  const expired = remaining !== null && remaining <= 0;

  const flushAttempt = useCallback(async (attemptId: string) => {
    const answers = answersRef.current.get(attemptId);
    const elapsedSec = elapsedRef.current.get(attemptId);
    const patch: Partial<Attempt> = {};
    if (answers) patch.answers = answers;
    if (elapsedSec !== undefined) patch.elapsedSec = elapsedSec;
    await db.attempts.update(attemptId, patch);
  }, []);

  // Clock: ticks the display and the active attempt's elapsed time.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (attempt && !attempt.submittedAt) {
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
    if (!session || !data || submittingRef.current) return;
    submittingRef.current = true;
    for (const a of data.attempts) {
      await flushAttempt(a.id);
      if (!a.submittedAt) await db.attempts.update(a.id, { submittedAt: Date.now() });
    }
    nav(`/session/${session.id}`, { replace: true });
  }, [session, data, flushAttempt, nav]);

  // Time's up: lock and submit everything.
  useEffect(() => {
    if (expired && data && !submittingRef.current) void submitAll();
  }, [expired, data, submitAll]);

  const onAnswerChange = (attemptId: string, label: string, doc: unknown, text: string) => {
    const current = answersRef.current.get(attemptId) ?? [];
    const existing = current.find((x) => x.label === label);
    const next = existing
      ? current.map((x) => (x.label === label ? { ...x, doc, text } : x))
      : [...current, { label, doc, text }];
    answersRef.current.set(attemptId, next);
    const prev = flushTimers.current.get(attemptId);
    if (prev) clearTimeout(prev);
    flushTimers.current.set(attemptId, window.setTimeout(() => void flushAttempt(attemptId), 600));
  };

  const toggleFlag = async (attemptId: string, label: string) => {
    const current = answersRef.current.get(attemptId) ?? [];
    const existing = current.find((x) => x.label === label);
    const next = existing
      ? current.map((x) => (x.label === label ? { ...x, flagged: !x.flagged } : x))
      : [...current, { label, doc: null, text: "", flagged: true }];
    answersRef.current.set(attemptId, next);
    await flushAttempt(attemptId);
  };

  const goTo = async (i: number, label = "") => {
    if (!session) return;
    if (attempt) await flushAttempt(attempt.id);
    const next = { ...session, index: i };
    saveSession(next);
    setSession(next);
    setActivePart(label);
    setTimeout(() => document.getElementById(`part-${label || "stem"}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };

  const submitCurrent = async () => {
    if (!attempt || !session) return;
    await flushAttempt(attempt.id);
    await db.attempts.update(attempt.id, { submittedAt: Date.now() });
    nav(`/mark/${attempt.id}`);
  };

  const sidebar = useMemo(() => {
    if (!data) return [];
    return data.questions.flatMap((q, i) =>
      answerParts(q).map((p) => ({ i, label: p.label, text: `${i + 1}${p.label ? " " + partLabel(p.label) : ""}` })),
    );
  }, [data]);

  if (!session || !data || !question || !attempt) return null;
  const locked = !!attempt.submittedAt || expired;
  const parts = answerParts(question);
  const cached = answersRef.current.get(attempt.id) ?? attempt.answers;
  const unsubmitted = data.attempts.filter((a) => !a.submittedAt).length;

  return (
    <>
      <div className="paper-top">
        <span className="muted">{session.mode === "exam" ? "Exam" : "Practice"} · question {index + 1} of {data.questions.length}</span>
        {remaining !== null && (
          <span className={"timer" + (remaining <= 60 ? " low" : "")}>{formatDuration(remaining)}</span>
        )}
        <span style={{ flex: 1 }} />
        {session.mode === "practice" ? (
          <button className="primary" onClick={submitCurrent} disabled={locked}>
            {attempt.submittedAt ? "Submitted" : "Submit answer"}
          </button>
        ) : (
          <button className="primary" onClick={submitAll} disabled={expired}>Submit paper ({unsubmitted} left)</button>
        )}
      </div>
      <div className="paper">
        <div className="paper-side">
          {sidebar.map((row) => {
            const a = data.attempts[row.i];
            const flagged = (answersRef.current.get(a.id) ?? a.answers).find((x) => x.label === row.label)?.flagged;
            const current = row.i === index && (row.label === activePart || parts.length === 1);
            return (
              <button
                key={`${row.i}-${row.label}`}
                className={(current ? "current " : "") + (a.submittedAt ? "done" : "")}
                onClick={() => goTo(row.i, row.label)}
              >
                {row.text}{flagged ? <span className="flag">⚑</span> : null}
              </button>
            );
          })}
        </div>
        <div className="paper-stem">
          <div className="qnum">Question {index + 1}</div>
          <div className="pre">{question.text}</div>
        </div>
        <div className="paper-answers">
          {parts.map((p) => {
            const ans = cached.find((x) => x.label === p.label);
            return (
              <div key={`${attempt.id}-${p.label}`} className="part" id={`part-${p.label || "stem"}`}>
                <div className="part-head">
                  {p.label && <span className="label">{partLabel(p.label)}</span>}
                  <span className="text">{p.text}</span>
                  {p.marks !== undefined && <span className="marks">({p.marks} mark{p.marks === 1 ? "" : "s"})</span>}
                  <button className={"small" + (ans?.flagged ? " active" : "")} title="Flag for review" onClick={() => toggleFlag(attempt.id, p.label)}>⚑</button>
                </div>
                <Editor
                  initial={ans?.doc}
                  locked={locked}
                  onChange={(doc, text) => onAnswerChange(attempt.id, p.label, doc, text)}
                  onFocus={() => setActivePart(p.label)}
                />
              </div>
            );
          })}
          {index < data.questions.length - 1 && (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button onClick={() => goTo(index + 1)}>Next question →</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
