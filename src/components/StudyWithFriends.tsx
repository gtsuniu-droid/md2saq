import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Question, QuestionSet } from "../data/types";
import { formatDate } from "../lib/questions";
import { createStudySession, fetchStudySession, formatCode, joinStudySession, normaliseCode, studyRecords, type StudyRecord, type StudySession } from "../lib/study";
import { PRESENTATIONS } from "../data/presentations";

interface Props {
  /** The paper to publish when "Create a code" is pressed: the practice selection, or a fresh six-stem exam. */
  buildPaper: () => Question[];
  sets: QuestionSet[];
  presentations: string[];
  mode: "practice" | "exam";
  minutes: number;
  examTiming?: { readingSec: number; totalSec: number };
  signedIn: boolean;
  canCreate: boolean;
  starting: boolean;
  onStart: (questionIds: string[], study: StudySession) => void;
  /** "create": the row inside the session builder. "join": the six boxes on the home page. */
  variant?: "create" | "join";
}

/** Six boxes that fill left to right, accept a pasted code, and report when all six are in. */
export function CodeBoxes({ value, onChange, disabled }: { value: string; onChange: (code: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = normaliseCode(value).padEnd(6, " ").split("").slice(0, 6);
  const set = (next: string, focus: number) => { onChange(normaliseCode(next)); const el = refs.current[Math.min(5, Math.max(0, focus))]; el?.focus(); };
  return (
    <div className="code-boxes" role="group" aria-label="Study code">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" pattern="[0-9]*" maxLength={6} aria-label={`Digit ${i + 1}`} value={d.trim()} disabled={disabled}
          onChange={(e) => { const typed = normaliseCode(e.target.value); if (typed.length > 1) { set(typed, typed.length); return; } const chars = digits.map((x) => x.trim()); chars[i] = typed; set(chars.join(""), typed ? i + 1 : i); }}
          onKeyDown={(e) => { if (e.key === "Backspace" && !d.trim() && i > 0) { e.preventDefault(); const chars = digits.map((x) => x.trim()); chars[i - 1] = ""; set(chars.join(""), i - 1); } if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus(); if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus(); }}
          onPaste={(e) => { const pasted = normaliseCode(e.clipboardData.getData("text")); if (pasted) { e.preventDefault(); set(pasted, pasted.length); } }} />
      ))}
    </div>
  );
}

const describeTiming = (s: StudySession): string => s.mode === "exam" ? `Exam, ${Math.round((s.readingSec ?? 0) / 60)} min reading then ${Math.round((s.totalSec ?? 0) / 3600 * 10) / 10} h writing, strict clock` : `Practice, ${s.minutes ? `${s.minutes} minutes` : "untimed"}`;

const presentationNames = (ids: string[]) => ids.map((id) => PRESENTATIONS.find((p) => p.id === id)?.name ?? id).join(", ");

function Participants({ study, me }: { study: StudySession; me?: string }) {
  return (
    <ul className="study-people" aria-label="Joined so far">
      {study.participants.map((p) => <li key={p.uid}><span className="lb-avatar plain" aria-hidden="true">{p.photo ? <img src={p.photo} alt="" referrerPolicy="no-referrer" /> : p.name.charAt(0).toUpperCase()}</span><span>{p.name}</span>{p.uid === study.hostUid && <span className="lb-you">host</span>}{p.uid === me && p.uid !== study.hostUid && <span className="lb-you">you</span>}</li>)}
    </ul>
  );
}

/** Inside New session: make a code for the current selection, or join a friend's. */
export default function StudyWithFriends({ buildPaper, sets, presentations, mode, minutes, examTiming, signedIn, canCreate, starting, onStart, variant = "create" }: Props) {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(() => normaliseCode(params.get("join") ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<StudySession | null>(null);
  const [found, setFound] = useState<StudySession | null>(null);
  const [copied, setCopied] = useState("");
  const [recent, setRecent] = useState<StudyRecord[]>([]);
  const polled = useRef(0);

  useEffect(() => { void studyRecords().then((r) => setRecent(r.slice(0, 5))); }, [created?.code, found?.code]);
  // The joined list keeps itself fresh while the code card is open.
  useEffect(() => {
    const open = created ?? found;
    if (!open) return;
    const tick = async () => { try { const fresh = await fetchStudySession(open.code); if (fresh) (created ? setCreated : setFound)(fresh); } catch { /* keep what we have */ } };
    const timer = window.setInterval(() => { polled.current++; void tick(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [created?.code, found?.code]);
  // Arriving by a shared link (?join=CODE) looks the code up at once.
  useEffect(() => { if (signedIn && code.length === 6 && (params.get("join") || variant === "join") && !found && !busy) void join(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, code]);

  const create = async () => {
    setBusy(true); setError("");
    try { setCreated(await createStudySession(buildPaper(), sets, mode === "exam" ? { mode, presentations, ...examTiming } : { mode, minutes, presentations })); setFound(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create a code."); }
    finally { setBusy(false); }
  };
  const join = async () => {
    setBusy(true); setError("");
    try {
      const study = await fetchStudySession(code);
      if (!study) throw new Error("No session has that code. Check the digits with your friend.");
      setFound(study); setCreated(null);
      if (params.get("join")) { params.delete("join"); setParams(params, { replace: true }); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not find that code."); }
    finally { setBusy(false); }
  };
  const startJoined = async () => {
    if (!found) return;
    setBusy(true); setError("");
    try { const ids = await joinStudySession(found); onStart(ids, found); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not join."); setBusy(false); }
  };
  const copy = async (what: "code" | "link") => {
    if (!created) return;
    const text = what === "code" ? created.code : `${location.origin}/home?join=${created.code}`;
    try { await navigator.clipboard.writeText(text); setCopied(what); window.setTimeout(() => setCopied(""), 1500); } catch { setCopied(""); }
  };

  if (!signedIn) return variant === "join"
    ? <p className="muted">Sign in to join a friend's session.</p>
    : <div className="study-row"><p className="muted">Sign in to {mode === "exam" ? "sit an exam" : "study"} with friends: one code gives everyone the same {mode === "exam" ? "paper" : "questions"}, then you compare answers.</p></div>;

  if (variant === "join" && !found) return (
    <div className="study-join-boxes">
      <CodeBoxes value={code} onChange={(c) => { setCode(c); setError(""); }} disabled={busy} />
      {busy && <p className="muted" role="status">Looking for that session…</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );

  return (
    <div className="study-block">
      {created ? (
        <section className="study-card" aria-label="Your study code">
          <div className="study-code-pane">
            <span className="study-eyebrow">Your study code</span>
            <div className="study-digits" aria-label={`Code ${created.code}`}>{created.code.split("").map((d, i) => <span key={i} className={i === 3 ? "gap" : undefined}>{d}</span>)}</div>
            <p className="muted">Anyone who enters this code on their home page gets {created.mode === "exam" ? "this exact exam" : `these ${created.questions.length} questions in this order`}. It works for 7 days.</p>
            <div className="row"><button type="button" className="small" onClick={() => void copy("code")}>{copied === "code" ? "Copied" : "Copy code"}</button><button type="button" className="small" onClick={() => void copy("link")}>{copied === "link" ? "Copied" : "Copy link"}</button></div>
          </div>
          <div className="study-people-pane">
            <div className="row spread"><strong>Joined so far</strong><span className="muted">{created.participants.length} {created.participants.length === 1 ? "person" : "people"}</span></div>
            <Participants study={created} />
            <p className="muted">Everyone works at their own pace. Afterwards, Compare answers is on the session summary.</p>
          </div>
          <div className="study-card-foot">
            <div><strong>{created.questions.length} questions</strong><span className="muted">{describeTiming(created)}, same order for everyone</span></div>
            <div className="row"><button type="button" onClick={() => setCreated(null)} disabled={starting}>Close</button><button type="button" className="primary" disabled={starting} onClick={() => { void studyRecords().then((rs) => { const r = rs.find((x) => x.code === created.code); if (r) onStart(r.questionIds, created); }); }}>{starting ? "Preparing…" : created.mode === "exam" ? "Start the exam" : "Start practice"}</button></div>
          </div>
        </section>
      ) : found ? (
        <section className="study-card found" aria-label="Study session found">
          <div className="study-code-pane">
            <span className="study-eyebrow">Found: {found.hostName}'s {found.mode === "exam" ? "exam" : "session"}</span>
            <strong className="study-found-title">{found.questions.length} questions. {describeTiming(found)}</strong>
            <p>{presentationNames(found.presentations) || "Mixed presentations"}</p>
            <p className="muted">Code {formatCode(found.code)}. You get the same questions in the same order.</p>
          </div>
          <div className="study-people-pane">
            <div className="row spread"><strong>Joined so far</strong><span className="muted">{found.participants.length}</span></div>
            <Participants study={found} />
          </div>
          <div className="study-card-foot">
            <span className="muted">{found.mode === "exam" ? "The clock starts when you press start and does not stop." : "The host set the time."} Compare answers with everyone afterwards.</span>
            <div className="row"><button type="button" onClick={() => { setFound(null); setCode(""); }} disabled={busy}>Cancel</button><button type="button" className="primary" disabled={busy || starting} onClick={() => void startJoined()}>{busy || starting ? "Preparing…" : found.mode === "exam" ? "Start the same exam" : "Start the same questions"}</button></div>
          </div>
        </section>
      ) : (
        <div className="study-row">
          <div className="study-row-text">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.7 0-5 1.4-5 3.5V19h10v-2.5C13 14.4 10.7 13 8 13Zm8 0c-.4 0-.8 0-1.2.1 1.3.9 2.2 2 2.2 3.4V19h4v-2.5c0-2.1-2.3-3.5-5-3.5Z" fill="currentColor" /></svg>
            <span><strong>{mode === "exam" ? "Sit this exam with friends." : "Study with friends."}</strong> <button type="button" className="link" disabled={busy || !canCreate} title={canCreate ? (mode === "exam" ? "Make a code for a six-stem exam everyone sits together" : "Make a code for the questions selected above") : (mode === "exam" ? "Six presentations with sets are needed first" : "Choose presentations and questions above first")} onClick={() => void create()}>{busy && !code ? "Creating…" : "Create a code"}</button> {mode === "exam" ? "so everyone gets the identical paper under the same strict clock." : "for this selection so everyone gets the same questions."}</span>
          </div>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      {recent.length > 0 && !created && !found && variant !== "create" && (
        <p className="study-recent muted">Recent: {recent.map((r, i) => <span key={r.code}>{i > 0 && ", "}<Link to={`/study/${r.code}`}>{formatCode(r.code)}</Link> ({r.role === "host" ? "yours" : r.hostName}, {formatDate(r.startedAt)})</span>)}</p>
      )}
    </div>
  );
}
