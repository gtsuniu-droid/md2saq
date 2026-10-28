import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Link, useNavigate } from "react-router";
import { db, getSettings, newId } from "../data/db";
import { ERROR_TAGS, type Attempt, type Mark, type PartMark, type Question, type QuestionSet } from "../data/types";
import QuickEdit from "./QuickEdit";
import AmbossText from "./AmbossText";
import AnswerHtml from "./AnswerHtml";
import AutoTextarea from "./AutoTextarea";
import CommentedAnswer from "./CommentedAnswer";
import ModelAnswerContent from "./ModelAnswerContent";
import QuestionCommunity from "./QuestionCommunity";
import FixWithClaude from "./FixWithClaude";
import { belongsToAccount } from "../lib/progressAccount";
import { setAttemptReview } from "../lib/setAttemptReview";
import { introducedStems, markingDraft, reconcileMarkingParts, type MarkingDraft } from "../lib/markingSet";
import { saveSetMarking } from "../lib/saveMarking";
import { setLabel } from "../lib/sets";
import { answerParts, partLabel, stemsOf } from "../lib/questions";
import { hasModelAnswer, richAnswerDocument } from "../lib/modelAnswer";
import { isAdmin } from "../lib/admin";
import { loadSession, saveSession } from "../lib/session";
import { sessionAtQuestion } from "../lib/sessionNavigation";
import { questionRef, requestSync } from "../lib/sync";
import { clearMarkingDraft, loadMarkingDraft, writeMarkingDraft } from "../lib/markingDrafts";
import { buildSetForMarking, setText } from "../lib/setForMarking";
import { keepForMarking, markFilled, newSuggestions, placeSuggestedComments } from "../lib/suggestedMarks";

interface Props {
  attemptId: string;
  /** Inside the paper: no heading or sidebar of its own, and the paper decides where to go after saving. */
  embedded?: boolean;
  onAdvance?: () => void;
  /** Element ids the host's sidebar scrolls to, keyed by question id and part label. */
  partId?: (questionId: string, label: string) => string;
}

/**
 * Mark a whole set where it was answered: case stem on the left, each answer on the
 * right with the model answer and score beneath it, comments in the margin.
 */
export default function SetMarking({ attemptId, embedded = false, onAdvance, partId }: Props) {
  const nav = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const animated = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, MarkingDraft>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const fallbackIds = useRef<string[]>([]);
  const previousRoute = useRef(attemptId);
  if (previousRoute.current !== attemptId) { previousRoute.current = attemptId; fallbackIds.current = []; }
  const [message, setMessage] = useState("");
  const [draftWarning, setDraftWarning] = useState("");
  const [editing, setEditing] = useState<Question | null>(null);
  const [editingMode, setEditingMode] = useState<"stem" | "question">("question");
  const [active, setActive] = useState<string>("");
  const liveData = useLiveQuery(async () => {
    const settings = await getSettings();
    const ownerId = settings.cloudUser?.uid ?? "";
    const [allAttempts, questions, allMarks] = await Promise.all([db.attempts.toArray(), db.questions.toArray(), db.marks.toArray()]);
    const attempts = allAttempts.filter((a) => belongsToAccount(a, ownerId));
    const marks = allMarks.filter((m) => belongsToAccount(m, ownerId));
    const anchorId = attempts.some((a) => a.id === attemptId) ? attemptId : fallbackIds.current.find((id) => attempts.some((a) => a.id === id));
    const review = anchorId ? setAttemptReview(anchorId, attempts, questions, marks, ownerId) : null;
    if (!review) return null;
    const set = review.setId ? await db.sets.get(review.setId) : undefined;
    const examLocked = review.anchor.mode === "exam" && attempts.some((a) => (review.anchor.sessionId ? a.sessionId === review.anchor.sessionId : a.id === attemptId) && a.submittedAt === undefined);
    const session = loadSession(ownerId);
    const inSession = session?.id === review.anchor.sessionId ? session : null;
    const lastIndex = inSession ? Math.max(...review.rows.flatMap((r) => r.attempt ? [inSession.attemptIds.indexOf(r.attempt.id)] : [])) : -1;
    const nextId = inSession && lastIndex >= 0 ? inSession.attemptIds[lastIndex + 1] : undefined;
    const nextAttempt = nextId ? attempts.find((a) => a.id === nextId) : undefined;
    return { ...review, set, attempts, marks, questions, admin: isAdmin(settings), ownerId, examLocked, inSession, nextAttempt };
  }, [attemptId]);
  const lastData = useRef(liveData);
  if (liveData) lastData.current = liveData;
  const data = liveData ?? (editing ? lastData.current : liveData);

  useEffect(() => {
    if (!data) return;
    fallbackIds.current = data.rows.flatMap((r) => r.attempt ? [r.attempt.id] : []);
    setDrafts((current) => {
      const next: Record<string, MarkingDraft> = {};
      for (const { question, attempt, mark } of data.rows) {
        if (!question || !attempt || attempt.submittedAt === undefined) continue;
        const recovered = current[attempt.id] ?? loadMarkingDraft(data.ownerId, attempt.id, question.id, mark);
        next[attempt.id] = recovered ? reconcileMarkingParts(recovered, question) : markingDraft(question, attempt, mark);
      }
      return next;
    });
  }, [data]);

  const readyNow = !!data && data.rows.some((r) => r.attempt && drafts[r.attempt.id]);
  useEffect(() => {
    if (!readyNow || animated.current || !rootRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    animated.current = true;
    const ctx = gsap.context(() => {
      gsap.from(".mark-panel", { y: 14, opacity: 0, duration: 0.45, stagger: 0.06, ease: "power2.out", clearProps: "all" });
      gsap.from(".mark-set-save", { y: 10, opacity: 0, duration: 0.4, delay: 0.3, ease: "power2.out", clearProps: "all" });
    }, rootRef);
    return () => ctx.revert();
  }, [readyNow]);

  // The set laid out for marking: copied by "Copy set", and kept in the student's private store
  // so that marks suggested for it (through their connector) can come back to this page.
  const forMarking = useMemo(() => data ? buildSetForMarking(data.anchor.id, data.set ? setLabel(data.set) : data.anchor.qref?.setName || "Set", data.rows, data.set) : null, [data]);
  const forMarkingJson = useMemo(() => forMarking ? JSON.stringify(forMarking) : "", [forMarking]);
  useEffect(() => { if (forMarking && data?.ownerId) void keepForMarking(forMarking).catch(() => undefined); }, [forMarkingJson]);
  const [copied, setCopied] = useState(false);
  const copy = () => { if (forMarking) void navigator.clipboard.writeText(setText(forMarking)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  // Parts given a suggested score, per attempt, so their score boxes show it.
  const [suggested, setSuggested] = useState<Record<string, Set<string>>>({});
  useEffect(() => {
    if (!readyNow || !data?.ownerId) return;
    const { anchor, rows, ownerId } = data;
    let live = true;
    // Filled in when the page opens, and on coming back to it from wherever the set was marked.
    const check = async () => {
      const marks = await newSuggestions(anchor.id).catch(() => null);
      if (!marks || !live) return;
      setDrafts((current) => {
        const next = { ...current };
        for (const { question, attempt, mark } of rows) {
          const draft = attempt && current[attempt.id];
          const parts = marks.parts.filter((p) => p.attemptId === attempt?.id);
          if (!draft || !question || !parts.length) continue;
          next[attempt.id] = { ...draft, parts: draft.parts.map((pm) => { const s = parts.find((p) => p.label === pm.label); return s ? { ...pm, score: pm.maxScore ? Math.min(s.score, pm.maxScore) : s.score } : pm; }) };
          writeMarkingDraft(ownerId, attempt.id, question.id, next[attempt.id], mark);
        }
        // The overall note goes with the first question, unless the student wrote one there already.
        const first = rows.find((r) => r.attempt && next[r.attempt.id]);
        if (marks.summary && first?.attempt && !next[first.attempt.id].notes.trim()) next[first.attempt.id] = { ...next[first.attempt.id], notes: marks.summary };
        return next;
      });
      setSuggested(Object.fromEntries(rows.flatMap((r) => r.attempt ? [[r.attempt.id, new Set(marks.parts.filter((p) => p.attemptId === r.attempt!.id).map((p) => p.label))]] : [])));
      await placeSuggestedComments(marks);
      markFilled(anchor.id, marks);
      if (live) setMessage("Suggested marks filled in. Check them, then save.");
    };
    void check();
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; document.removeEventListener("visibilitychange", onVisible); };
  }, [readyNow, data?.anchor.id, data?.ownerId]);

  if (data === undefined) return <p className="muted" role="status" style={{ padding: "1.5rem" }}>Loading your set…</p>;
  if (!data) return <div style={{ padding: "1.5rem" }}><Link to="/home#history">Back to history</Link><p>Attempt not found for this account.</p></div>;
  if (data.examLocked) return <div style={{ padding: "1.5rem" }}><h1>Submit the paper to begin marking</h1><Link to="/paper">Continue paper</Link></div>;
  const { anchor, rows, set, inSession } = data;
  const readyRows = rows.filter((r) => r.question && r.attempt?.submittedAt !== undefined);
  const ready = readyRows.length > 0 && readyRows.every((r) => drafts[r.attempt!.id]);
  const allParts = readyRows.flatMap((r) => drafts[r.attempt!.id]?.parts ?? []);
  const total = allParts.reduce((sum, p) => sum + p.score, 0);
  const maximum = allParts.reduce((sum, p) => sum + p.maxScore, 0);
  const firstQuestion = rows.find((r) => r.question)?.question;
  const stems = firstQuestion ? stemsOf(firstQuestion) : [];
  const stemTexts = [...stems, ...rows.flatMap((r) => r.question ? [r.question.text, ...r.question.parts.map((p) => p.text)] : [])];
  const idFor = (question: Question | undefined, order: number, label: string) => question && partId ? partId(question.id, label) : `mark-${order}-${label || "q"}`;

  const save = async (advance: boolean) => {
    if (!ready || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setMessage("");
    try {
      const entries = await Promise.all(readyRows.map(async ({ question, attempt, mark }) => {
        const draft = drafts[attempt!.id];
        const value: Mark = {
          ...mark, id: mark?.id ?? newId(), attemptId: attempt!.id, ownerId: data.ownerId,
          questionId: question!.id, qref: mark?.qref ?? await questionRef(question!),
          score: 0, maxScore: 0, parts: draft.parts, errorTags: draft.errorTags,
          learningPoint: draft.learningPoint.trim() || undefined, notes: draft.notes.trim() || undefined,
          reviewLater: draft.reviewLater || draft.lookedAtAnswer, lookedAtAnswer: draft.lookedAtAnswer, markedAt: Date.now(),
        };
        return { mark: value, confidence: draft.confidence };
      }));
      await saveSetMarking(entries);
      for (const { attempt } of readyRows) clearMarkingDraft(data.ownerId, attempt!.id, drafts[attempt!.id]);
      setDraftWarning("");
      requestSync();
      if (!advance) { setMessage("Marks saved"); return; }
      if (embedded && onAdvance) { onAdvance(); return; }
      const current = loadSession(data.ownerId);
      if (inSession && current?.id === inSession.id && data.nextAttempt) {
        if (data.nextAttempt.submittedAt !== undefined) nav(`/mark/${data.nextAttempt.id}`);
        else {
          saveSession(sessionAtQuestion(current, data.questions, current.attemptIds.indexOf(data.nextAttempt.id)));
          nav("/paper");
        }
      } else nav(inSession ? `/session/${inSession.id}` : `/history/${anchor.id}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save the marks. Please try again."); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const deleted = () => {
    const replacement = rows.find((r) => r.attempt && r.question?.id !== editing?.id)?.attempt;
    setEditing(null);
    if (!embedded) nav(replacement ? `/mark/${replacement.id}` : `/set/${data.setId}`, { replace: true });
  };

  const jump = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const sidebar = !embedded && (
    <nav className="paper-side mark-side" aria-label="Questions in this set">
      {rows.map(({ question, attempt, order }) => {
        const draft = attempt ? drafts[attempt.id] : undefined;
        const parts = question ? answerParts(question) : [{ label: "" }];
        return parts.map((p) => {
          const id = idFor(question, order, p.label);
          const pm = draft?.parts.find((x) => x.label === p.label);
          return <button key={id} className={(active === id ? "current" : "") + (attempt?.submittedAt ? " done" : "")} onClick={() => jump(id)}>
            <span>{order + 1}{p.label ? ` (${p.label})` : ""}</span>
            {pm && <span className="mark-side-score">{pm.score}/{pm.maxScore}</span>}
          </button>;
        });
      })}
    </nav>
  );

  const body = (
    <div className="paper-split mark-split">
      <div className="paper-stem">
        <div className="col-head"><span>Case stem</span><span style={{ flex: 1 }} />{data.admin && firstQuestion && <button className="small hl-btn" onClick={() => { setEditingMode("stem"); setEditing(firstQuestion); }}>Edit case stem</button>}</div>
        {rows.map(({ question, order }, index) => {
          if (!question) return null;
          const newStems = introducedStems(question, rows[index - 1]?.question);
          if (!newStems.length) return null;
          return <div key={question.id} className="mark-stem-stage">
            {index > 0 && <div className="muted" style={{ fontSize: ".8rem", marginBottom: ".2rem" }}>From question {order + 1}</div>}
            {newStems.map(({ text: stem, index: si }) => <div key={si} className="stem-block"><AmbossText cacheKey={question.id} texts={stemTexts} text={stem} doc={question.stemDocs?.[si]} highlights={rows.filter((r) => r.question && JSON.stringify(stemsOf(r.question)) === JSON.stringify(stemsOf(question))).flatMap((r) => r.attempt?.stemHighlights ?? []).filter((h) => h.stem === si)} /></div>)}
            {(question.images ?? []).filter((im) => im.place === "stem").map((im) => <figure key={im.id} className="qimg"><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption className="muted">{im.caption}</figcaption>}</figure>)}
          </div>;
        })}
        {stems.length === 0 && <div className="muted">No case stem.</div>}
        {set?.markingNotes && <details className="mark-guide-notes"><summary>Set marking notes</summary><p className="pre">{set.markingNotes}</p></details>}
      </div>
      <div className="paper-answers mark-answers">
        <div className="col-head"><span>Marking</span><span style={{ flex: 1 }} /><span className="col-head-total">{total} / {maximum}</span></div>
        <fieldset className="mark-set-fields" disabled={saving}>
          {rows.map(({ question, attempt, mark, order }) => {
            const draft = attempt ? drafts[attempt.id] : undefined;
            if (!question || attempt?.submittedAt === undefined || !draft) {
              return <section key={question?.id ?? attempt!.id} className="question-block" id={idFor(question, order, "")}>
                <div className="qhead"><span>{order + 1}</span></div>
                <AmbossText className="text marking-prompt" cacheKey={question?.id ?? attempt!.id} texts={[question?.text ?? ""]} text={question?.text || attempt?.qref?.text || "Question no longer available"} doc={question?.textDoc} />
                <p className="muted">{!question ? "This question has been removed. Your saved answer is below." : attempt?.submittedAt !== undefined ? "Loading marking…" : attempt ? "Not submitted yet" : "Not attempted in this sitting"}</p>
                {attempt?.answers.map((a) => <CommentedAnswer key={a.label} attemptId={attempt.id} partLabel={a.label} doc={a.doc} text={a.text} comments={attempt.answerComments ?? []} />)}
                {mark && <p className="muted">Saved score {mark.score}/{mark.maxScore}</p>}
                {question && attempt && attempt.submittedAt === undefined && inSession?.attemptIds.includes(attempt.id) && inSession.questionIds.includes(question.id) && <Link to="/paper" onClick={() => saveSession(sessionAtQuestion(inSession, data.questions, inSession.questionIds.indexOf(question.id)))}>Continue set</Link>}
              </section>;
            }
            const previous = data.attempts.filter((a) => a.questionId === question.id && a.id !== attempt.id && a.submittedAt !== undefined && (a.submittedAt ?? 0) < (attempt.submittedAt ?? attempt.startedAt)).sort((a, b) => b.submittedAt! - a.submittedAt!)[0];
            const previousMark = previous ? data.marks.filter((m) => m.attemptId === previous.id).sort((a, b) => b.markedAt - a.markedAt)[0] : undefined;
            return <MarkingBlock key={question.id} question={question} attempt={attempt} set={set} order={order} draft={draft} suggested={suggested[attempt.id]} previous={previous} previousMark={previousMark} admin={data.admin} hasMark={!!mark} stemTexts={stemTexts} idFor={(label) => idFor(question, order, label)}
              onFocusPart={(id) => setActive(id)} onEdit={(q) => { setEditingMode("question"); setEditing(q); }}
              onChange={(value) => {
                setDrafts((current) => ({ ...current, [attempt.id]: value }));
                setDraftWarning(writeMarkingDraft(data.ownerId, attempt.id, question.id, value, mark) ? "" : "Draft recovery is unavailable. Save marks before leaving this page.");
                setMessage("");
              }} />;
          })}
        </fieldset>
        {set?.debrief && <details className="card mark-debrief"><summary>Set debrief</summary><p className="pre">{set.debrief}</p></details>}
        <div className="mark-set-save" aria-label="Save marks">
          <div><strong>Set total {total} / {maximum}</strong><span className="muted">{message || draftWarning || "Your scores are kept on this device until you save."}</span></div>
          <span style={{ flex: 1 }} />
          <button disabled={saving || !ready} onClick={() => void save(false)}>{saving ? "Saving…" : "Save marks"}</button>
          <button className="primary" disabled={saving || !ready} onClick={() => void save(true)}>{embedded ? (data.nextAttempt ? "Save and next set" : "Save and finish") : data.nextAttempt ? "Save and next set" : "Save and finish"}</button>
        </div>
      </div>
    </div>
  );

  return <div ref={rootRef} className={embedded ? "set-marking embedded" : "set-marking"}>
    {!embedded && <div className="paper-top">
      <span className="paper-status">
        <span className="paper-mode">Marking</span>
        <span>{set ? setLabel(set) : anchor.qref?.setName || "Your set"}</span>
        <span>{rows.length} question{rows.length === 1 ? "" : "s"}</span>
      </span>
      <span style={{ flex: 1 }} />
      {forMarking?.questions.length ? <button title="Copy the case, the questions, your answers and the model answers, to paste anywhere" onClick={copy}>{copied ? "Copied" : "Copy set"}</button> : null}
      <Link className="button" to={inSession ? `/session/${inSession.id}` : "/home#history"}>{inSession ? "Session summary" : "Back to history"}</Link>
    </div>}
    <div className={embedded ? "paper mark-paper embedded" : "paper mark-paper"}>
      {sidebar}
      {body}
    </div>
    {editing && <QuickEdit question={editing} mode={editingMode} onClose={() => setEditing(null)} onDeleted={deleted} />}
  </div>;
}

function ModelIcon() {
  return <svg className="mark-model-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" opacity=".14" /><path d="M4.5 8.2 7 10.6l4.6-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

interface BlockProps {
  question: Question;
  attempt: Attempt;
  set?: QuestionSet;
  order: number;
  draft: MarkingDraft;
  previous?: Attempt;
  previousMark?: Mark;
  admin: boolean;
  /** A saved mark exists, so its scores are real values rather than untouched zeros. */
  hasMark: boolean;
  /** Parts given a suggested score, which shows even when it is zero. */
  suggested?: Set<string>;
  stemTexts: string[];
  onChange: (draft: MarkingDraft) => void;
  onEdit: (question: Question) => void;
  onFocusPart: (id: string) => void;
  idFor: (label: string) => string;
}

/** One question: its parts, each with your answer, the model answer and a score. */
function MarkingBlock({ question, attempt, set, order, draft, previous, previousMark, admin, hasMark, suggested, stemTexts, onChange, onEdit, onFocusPart, idFor }: BlockProps) {
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState(!!draft.notes || !!draft.learningPoint || draft.errorTags.length > 0);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setFolded((f) => ({ ...f, [key]: !f[key] }));
  const foldButton = (key: string, open: boolean) => <button type="button" className="mark-model-toggle" aria-expanded={open} onClick={() => toggle(key)}><ModelIcon />Model answer<span className="mark-model-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span></button>;
  const patch = <K extends keyof MarkingDraft>(key: K, value: MarkingDraft[K]) => onChange({ ...draft, [key]: value });
  const setPart = (label: string, change: Partial<PartMark>) => patch("parts", draft.parts.map((p) => (p.label === label ? { ...p, ...change } : p)));
  const partsInfo = answerParts(question).map((part) => ({ part, answer: attempt.answers.find((a) => a.label === part.label) }));
  const texts = [...stemTexts, ...partsInfo.map((pi) => pi.part.modelAnswer ?? "")];
  const wholeModel = question.parts.length > 0 && hasModelAnswer(question) && (richAnswerDocument(question) || !question.parts.some(hasModelAnswer));
  const showText = stemsOf(question).length > 0 || question.parts.length === 0;
  // A score box stays empty until something is typed in it, unless a saved mark already gives it a value.
  const [entered, setEntered] = useState<Set<string>>(new Set());
  const scoreField = (key: string, value: number, apply: (n: number) => void, max?: number, ariaLabel?: string, blankUntilEntered = false) => (
    <input aria-label={ariaLabel} type="number" inputMode="decimal" min={0} max={max} step="any" className="score-input" placeholder={blankUntilEntered ? "–" : undefined}
      value={typing[key] ?? (blankUntilEntered && !entered.has(key) && value === 0 ? "" : String(value))}
      onFocus={(e) => e.target.select()}
      onChange={(e) => { const raw = e.target.value; setTyping((t) => ({ ...t, [key]: raw })); setEntered((set) => new Set(set).add(key)); const n = Number(raw); if (raw !== "" && Number.isFinite(n)) apply(Math.max(0, n)); else if (raw === "") apply(0); }}
      onBlur={() => setTyping((t) => { const { [key]: _gone, ...rest } = t; void _gone; return rest; })} />
  );
  const total = draft.parts.reduce((a, p) => a + p.score, 0);
  const max = draft.parts.reduce((a, p) => a + p.maxScore, 0);
  const flagged = draft.reviewLater || draft.lookedAtAnswer;

  return (
    <section className="question-block mark-block" id={idFor("")} aria-label={`Question ${order + 1}`}>
      <div className="qhead">
        <span>{order + 1}</span>
        <span style={{ flex: 1 }} />
        <QuestionCommunity key={question.id} question={question} set={set} />
        {admin && <FixWithClaude set={set} question={question} />}
        {admin && <button className="small" onClick={() => onEdit(question)}>Edit question</button>}
      </div>
      {showText && (
        <div className="part-head" style={{ marginBottom: ".8rem" }}>
          <AmbossText cacheKey={question.id} texts={texts} text={question.text} doc={question.textDoc} className="text marking-prompt" />
          {question.parts.length === 0 && question.marks !== undefined && <span className="marks">({question.marks} mark{question.marks === 1 ? "" : "s"})</span>}
        </div>
      )}
      {(question.images ?? []).filter((im) => im.place === "question").map((im) => (
        <figure key={im.id} className="qimg"><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption className="muted">{im.caption}</figcaption>}</figure>
      ))}
      {wholeModel && <div className={"mark-panel whole" + (folded.whole ? " folded" : "")}><div className="mark-panel-head">{foldButton("whole", !folded.whole)}<span style={{ flex: 1 }} />{admin && <button type="button" className="small link mark-model-edit" onClick={() => onEdit(question)}>Edit</button>}</div>{!folded.whole && <div className="mark-model-body"><ModelAnswerContent answer={question} /></div>}</div>}

      {partsInfo.map((pi) => {
        const pm = draft.parts.find((p) => p.label === pi.part.label);
        if (!pm) return null;
        const prevAns = previous?.answers.find((a) => a.label === pi.part.label);
        const id = idFor(pi.part.label);
        return (
          <div key={pi.part.label} className="part mark-part" id={id} onFocusCapture={() => onFocusPart(id)}>
            {(pi.part.text || pi.part.textDoc) ? (
              <div className="part-head">
                {pi.part.label && <span className="label">{partLabel(pi.part.label)}</span>}
                <AmbossText cacheKey={question.id} texts={texts} text={pi.part.text} doc={pi.part.textDoc} className="text marking-prompt" />
                {question.parts.length > 0 && pi.part.marks !== undefined && <span className="marks">({pi.part.marks} mark{pi.part.marks === 1 ? "" : "s"})</span>}
              </div>
            ) : null}
            <div className="mark-answer-head">
              <h4>Your answer</h4>
              <span style={{ flex: 1 }} />
              <div className="mark-score">
                <label>Score</label>
                {scoreField(`score:${pi.part.label}`, pm.score, (n) => setPart(pi.part.label, { score: n }), pm.maxScore || undefined, `Score${pi.part.label ? ` for part ${pi.part.label}` : ""}`, !hasMark && !suggested?.has(pi.part.label))}
                <span className="mark-score-sep">/</span>
                {scoreField(`max:${pi.part.label}`, pm.maxScore, (n) => setPart(pi.part.label, { maxScore: n }), undefined, `Maximum score${pi.part.label ? ` for part ${pi.part.label}` : ""}`)}
              </div>
            </div>
            <CommentedAnswer key={`${attempt.id}:${pi.part.label}`} attemptId={attempt.id} partLabel={pi.part.label} doc={pi.answer?.doc} text={pi.answer?.text} comments={attempt.answerComments ?? []} margin />
            {previous && (
              <details className="mark-previous">
                <summary>Previous attempt{previousMark ? ` (${previousMark.parts.find((p) => p.label === pi.part.label)?.score ?? "?"}/${previousMark.parts.find((p) => p.label === pi.part.label)?.maxScore ?? "?"})` : ""}</summary>
                {prevAns?.doc ? <AnswerHtml doc={prevAns.doc} /> : <p className="pre">{prevAns?.text || "No answer written."}</p>}
              </details>
            )}
            <div className={"mark-panel" + (folded[pi.part.label] ? " folded" : "")}>
              <div className="mark-panel-head">
                {foldButton(pi.part.label, !folded[pi.part.label])}
                <span style={{ flex: 1 }} />
                {admin && <button type="button" className="small link mark-model-edit" onClick={() => onEdit(question)}>Edit</button>}
              </div>
              {!folded[pi.part.label] && <div className="mark-model-body">
                {hasModelAnswer(pi.part) ? <ModelAnswerContent answer={pi.part} /> : <p className="muted">{wholeModel ? "See the model answer above." : "No model answer for this part."}</p>}
              </div>}
            </div>
          </div>
        );
      })}

      <div className="mark-question-foot">
        <strong>Question {order + 1}: {total} / {max}</strong>
        <span style={{ flex: 1 }} />
        <label className="check"><input type="checkbox" checked={draft.lookedAtAnswer} onChange={(e) => onChange({ ...draft, lookedAtAnswer: e.target.checked, reviewLater: e.target.checked || draft.reviewLater })} /> Looked at the answer</label>
        <button className={"small review-later-button" + (flagged ? " selected" : "")} aria-pressed={flagged} disabled={draft.lookedAtAnswer} title={draft.lookedAtAnswer ? "Answer-assisted attempts are flagged for another review" : undefined} onClick={() => patch("reviewLater", !draft.reviewLater)}>{flagged ? "⚑ Review later" : "⚐ Review later"}</button>
        <button className="small" aria-expanded={noteOpen} onClick={() => setNoteOpen((o) => !o)}>{noteOpen ? "Hide note" : draft.notes ? "Note" : "Add note"}</button>
      </div>
      {noteOpen && <div className="mark-note">
        <AutoTextarea aria-label={`Note for question ${order + 1}`} placeholder="What do you want to remember from this question?" value={draft.notes} onChange={(e) => patch("notes", e.target.value)} style={{ minHeight: "4rem" }} />
        <div className="row mark-note-extra">
          <label className="mark-inline">Confidence<select value={draft.confidence ?? ""} onChange={(e) => patch("confidence", e.target.value ? Number(e.target.value) : undefined)}><option value="">Not rated</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === 1 ? " (guessing)" : n === 5 ? " (certain)" : ""}</option>)}</select></label>
          <label className="mark-inline">Learning point for Anki<input type="text" value={draft.learningPoint} onChange={(e) => patch("learningPoint", e.target.value)} /></label>
        </div>
        <div className="row">{ERROR_TAGS.map((t) => <button type="button" key={t.id} className={"chip" + (draft.errorTags.includes(t.id) ? " on" : "")} aria-pressed={draft.errorTags.includes(t.id)} onClick={() => patch("errorTags", draft.errorTags.includes(t.id) ? draft.errorTags.filter((x) => x !== t.id) : [...draft.errorTags, t.id])}>{t.label}</button>)}</div>
      </div>}
    </section>
  );
}
