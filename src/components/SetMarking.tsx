import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Link, useNavigate } from "react-router";
import { db, getSettings, newId } from "../data/db";
import { ERROR_TAGS, type Attempt, type Mark, type PartAnswer, type PartMark, type Question, type QuestionSet } from "../data/types";
import QuickEdit from "./QuickEdit";
import ConfirmDialog from "./ConfirmDialog";
import AmbossText from "./AmbossText";
import AnswerHtml from "./AnswerHtml";
import AutoTextarea from "./AutoTextarea";
import CommentedAnswer from "./CommentedAnswer";
import ModelPanel from "./ModelPanel";
import QuestionCommunity from "./QuestionCommunity";
import FixWithClaude from "./FixWithClaude";
import AssistantMenu from "./AssistantMenu";
import ExamMarking from "./ExamMarking";
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
import { buildSetForMarking, markPrompt, setText, type SetForMarking, type SuggestedMarks } from "../lib/setForMarking";
import { buildExamForMarking, examKey, examSets, paperScore } from "../lib/examMarking";
import { keepForMarking, markFilled, newSuggestions, placeSuggestedComments } from "../lib/suggestedMarks";
import { isGeneralComment } from "../lib/answerComments";
import { tickList, tickedScore } from "../lib/markingTicks";
import { wordDiff } from "../lib/wordDiff";
import RevisedAnswer from "./RevisedAnswer";
import LibraryUpdateNotice from "./LibraryUpdateNotice";
import { ensureSetContent } from "../lib/bank";
import { readCatalogue } from "../lib/library";
import { hasUnpublishedEdits } from "../lib/bankEditState";
import { discardAttempts } from "../lib/discardAttempts";
import { isBlankAttempt } from "../lib/blankAttempt";
import { hasAnswerContent } from "../lib/answerContent";
import { deleteComment, fetchRoom, shareMyAnswers, studyRecords, type PeerMark, type StudyComment, type StudyRecord, type StudyRoomView } from "../lib/study";
import { commentsOn, marksOn, peopleOf, type RoomPerson } from "../lib/studyRoom";
import { FriendComments, MarkChips } from "./StudyMarks";

/** What friends in a study session said about one of your answers. */
export interface FriendMarks { marks: PeerMark[]; comments: StudyComment[]; people: RoomPerson[]; me: string; onDelete: (id: string) => void }

interface Props {
  attemptId: string;
  /** Inside the paper: no heading or sidebar of its own, and the paper decides where to go after saving. */
  embedded?: boolean;
  /** Called after saving, or after discarding the set (`discarded`), when the paper decides where to go next. */
  onAdvance?: (outcome?: { discarded?: boolean }) => void;
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
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The study code this set was sat under, if any, with the room's marks and comments on your answers.
  const [friends, setFriends] = useState<{ record: StudyRecord; room: StudyRoomView } | null>(null);
  const liveData = useLiveQuery(async () => {
    const settings = await getSettings();
    const ownerId = settings.cloudUser?.uid ?? "";
    // Only what this page needs, by index: the set's questions and every attempt at them (for the
    // previous mark), the sitting's attempts (for the next set), and the marks on those. Reading
    // the whole bank here made each saved keystroke of a revision reload every question.
    const anchor = (await db.attempts.bulkGet([attemptId, ...fallbackIds.current])).find((a): a is Attempt => !!a && belongsToAccount(a, ownerId));
    if (!anchor) return null;
    const session = loadSession(ownerId);
    const inSession = session?.id === anchor.sessionId ? session : null;
    const anchorQuestion = await db.questions.get(anchor.questionId);
    const setId = anchorQuestion?.setId ?? anchor.qref?.setId;
    const setQuestions: Question[] = setId ? await db.questions.where("setId").equals(setId).toArray() : anchorQuestion ? [anchorQuestion] : [];
    const sessionQuestions: Question[] = inSession ? (await db.questions.bulkGet(inSession.questionIds)).filter((q): q is Question => !!q) : [];
    const [atSet, inSitting] = await Promise.all([
      db.attempts.where("questionId").anyOf(setQuestions.map((q) => q.id)).toArray(),
      anchor.sessionId ? db.attempts.where("sessionId").equals(anchor.sessionId).toArray() : Promise.resolve([anchor]),
    ]);
    // The rest of an exam paper (its other sets' questions and the sets themselves), so the whole paper can be laid out for marking at once.
    const sitting = inSitting.filter((a) => belongsToAccount(a, ownerId));
    const sittingQuestions: Question[] = anchor.mode === "exam" && anchor.sessionId ? (await db.questions.bulkGet([...new Set(sitting.map((a) => a.questionId))])).filter((q): q is Question => !!q) : [];
    const questions: Question[] = [...new Map([...setQuestions, ...sessionQuestions, ...sittingQuestions].map((q) => [q.id, q])).values()];
    const paperSetIds = [...new Set(sitting.map((a) => sittingQuestions.find((q) => q.id === a.questionId)?.setId ?? a.qref?.setId ?? a.id))];
    const wholeExam = sittingQuestions.length > 0 && paperSetIds.length > 1;
    const paperSets: QuestionSet[] = wholeExam ? (await db.sets.bulkGet(paperSetIds)).filter((s): s is QuestionSet => !!s) : [];
    const attempts = [...new Map([anchor, ...atSet, ...inSitting].filter((a) => belongsToAccount(a, ownerId)).map((a) => [a.id, a])).values()];
    const marks = (await db.marks.where("attemptId").anyOf(attempts.map((a) => a.id)).toArray()).filter((m) => belongsToAccount(m, ownerId));
    const review = setAttemptReview(anchor.id, attempts, questions, marks, ownerId);
    if (!review) return null;
    const set = review.setId ? await db.sets.get(review.setId) : undefined;
    const examLocked = review.anchor.mode === "exam" && attempts.some((a) => (review.anchor.sessionId ? a.sessionId === review.anchor.sessionId : a.id === attemptId) && a.submittedAt === undefined);
    const lastIndex = inSession ? Math.max(...review.rows.flatMap((r) => r.attempt ? [inSession.attemptIds.indexOf(r.attempt.id)] : [])) : -1;
    const nextId = inSession && lastIndex >= 0 ? inSession.attemptIds[lastIndex + 1] : undefined;
    const nextAttempt = nextId ? attempts.find((a) => a.id === nextId) : undefined;
    return { ...review, set, attempts, marks, questions, admin: isAdmin(settings), ownerId, examLocked, inSession, nextAttempt, sitting, sittingQuestions, paperSets, wholeExam };
  }, [attemptId]);
  const lastData = useRef(liveData);
  if (liveData) lastData.current = liveData;
  const data = liveData ?? (editing ? lastData.current : liveData);
  // The bank's current revision of this set: a newer one downloads, unless this device holds
  // unpublished edits to the set, in which case the page offers it.
  const bankRevision = useLiveQuery(async () => {
    const set = data?.set; if (!set) return undefined;
    return (await readCatalogue())?.entries.find((e) => e.id === set.bankId || e.set.id === set.id)?.revision;
  }, [data?.set?.id, data?.set?.bankId]);
  const behind = !!data?.set && bankRevision !== undefined && (data.set.bankUpdatedAt ?? 0) < bankRevision;
  useEffect(() => {
    if (!data?.set || !behind || hasUnpublishedEdits(data.set)) return;
    void ensureSetContent(data.set.id).catch(() => undefined);
  }, [data?.set?.id, behind]);

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
  // Admins only: their assistant reads the set through the connector and sends marks back here.
  const markPromptText = forMarking ? markPrompt(forMarking) : "";
  // An exam of several sets is also laid out whole, kept the same way, so the paper can be copied or marked in one go.
  const exam = useMemo<SetForMarking | null>(() => {
    if (!data?.wholeExam || !data.anchor.sessionId) return null;
    const built = buildExamForMarking(examKey(data.anchor.sessionId), examSets(data.sitting, data.sittingQuestions, data.paperSets, data.inSession?.attemptIds));
    return built.questions.length ? built : null;
  }, [data]);
  const wholeKey = exam?.key ?? "";
  // Parts given a suggested score, per attempt, so their score boxes show it.
  const [suggested, setSuggested] = useState<Record<string, Set<string>>>({});
  useEffect(() => {
    if (!readyNow || !data?.ownerId) return;
    const { anchor, rows, ownerId } = data;
    let live = true;
    // Filled in when the page opens, and on coming back to it from wherever the set was marked.
    const check = async () => {
      // Marks sent for this set, and for the whole paper when the set is part of an exam; the newer fill in last.
      const sources: [string, string][] = [[anchor.id, anchor.id], ...(wholeKey ? [[wholeKey, `${wholeKey}:${anchor.id}`] as [string, string]] : [])];
      const found = (await Promise.all(sources.map(async ([key, filledKey]) => { const marks = await newSuggestions(key, filledKey).catch(() => null); return marks ? { marks, filledKey, whole: key !== anchor.id } : null; })))
        .filter((f): f is { marks: SuggestedMarks; filledKey: string; whole: boolean } => !!f).sort((a, b) => a.marks.at - b.marks.at);
      if (!found.length || !live) return;
      for (const { marks, filledKey, whole } of found) {
        setDrafts((current) => {
          const next = { ...current };
          for (const { question, attempt, mark } of rows) {
            const draft = attempt && current[attempt.id];
            const parts = marks.parts.filter((p) => p.attemptId === attempt?.id);
            if (!draft || !question || !parts.length) continue;
            next[attempt.id] = { ...draft, parts: draft.parts.map((pm) => { const s = parts.find((p) => p.label === pm.label); return s ? { ...pm, score: pm.maxScore ? Math.min(s.score, pm.maxScore) : s.score, ...(s.rewrite ? { rewrite: s.rewrite } : {}) } : pm; }), scored: [...new Set([...(draft.scored ?? []), ...parts.map((p) => p.label)])] };
            writeMarkingDraft(ownerId, attempt.id, question.id, next[attempt.id], mark);
          }
          // The overall note goes with the first question, unless the student wrote one there already; a whole paper's note goes with the set the paper opens on.
          const first = rows.find((r) => r.attempt && next[r.attempt.id]);
          const here = !whole || rows.some((r) => r.attempt && r.attempt.id === marks.parts[0]?.attemptId);
          if (marks.summary && here && first?.attempt && !next[first.attempt.id].notes.trim()) next[first.attempt.id] = { ...next[first.attempt.id], notes: marks.summary };
          return next;
        });
        setSuggested((current) => ({ ...current, ...Object.fromEntries(rows.flatMap((r) => r.attempt ? [[r.attempt.id, new Set([...(current[r.attempt.id] ?? []), ...marks.parts.filter((p) => p.attemptId === r.attempt!.id).map((p) => p.label)])]] : [])) }));
        await placeSuggestedComments(marks);
        markFilled(filledKey, marks);
      }
      if (live) setMessage("Suggested marks filled in. Check them, then save.");
    };
    void check();
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; document.removeEventListener("visibilitychange", onVisible); };
  }, [readyNow, data?.anchor.id, data?.ownerId, wholeKey]);

  // A set sat with friends shows what they gave each of your answers, refreshed while the page is open.
  const anchorForFriends = data?.anchor;
  useEffect(() => {
    if (!anchorForFriends || !data?.ownerId) { setFriends(null); return; }
    let live = true; let timer = 0;
    const load = async () => {
      try {
        const record = (await studyRecords()).find((r) => r.questionIds.includes(anchorForFriends.questionId) && (r.sessionId === anchorForFriends.sessionId || Math.abs(anchorForFriends.startedAt - r.startedAt) < 12 * 3600_000));
        if (!record) { if (live) setFriends(null); return; }
        const room = await fetchRoom(record.code);
        if (live && room) setFriends({ record, room });
      } catch { /* the set marks fine without the room */ }
    };
    void load();
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    timer = window.setInterval(tick, 15_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [anchorForFriends?.id, data?.ownerId]);

  if (data === undefined) return <p className="muted" role="status" style={{ padding: "1.5rem" }}>Loading your set…</p>;
  if (!data) return <div style={{ padding: "1.5rem" }}><Link to="/home#history">Back to history</Link><p>Attempt not found for this account.</p></div>;
  if (data.examLocked) return <div style={{ padding: "1.5rem" }}><h1>Submit the paper to begin marking</h1><Link to="/paper">Continue paper</Link></div>;
  const { anchor, rows, set, inSession } = data;
  const readyRows = rows.filter((r) => r.question && r.attempt?.submittedAt !== undefined);
  const ready = readyRows.length > 0 && readyRows.every((r) => drafts[r.attempt!.id]);
  const allParts = readyRows.flatMap((r) => drafts[r.attempt!.id]?.parts ?? []);
  const total = allParts.reduce((sum, p) => sum + p.score, 0);
  const maximum = allParts.reduce((sum, p) => sum + p.maxScore, 0);
  // The whole paper so far: what is saved on the other sets, plus this set as it stands here.
  const paper = exam ? paperScore(data.sitting.filter((a) => !readyRows.some((r) => r.attempt?.id === a.id)), data.marks) : null;
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
      // Friends marking together see your own scores on your answers as soon as they are saved.
      if (friends) void shareMyAnswers(friends.record.code).then((room) => { if (room) setFriends((f) => f && { ...f, room }); }).catch(() => undefined);
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

  // Throw this sitting away: the set is unattempted again. A set with nothing written goes without asking.
  const discard = async (confirmed = false) => {
    if (savingRef.current) return;
    const attempts = readyRows.map((r) => r.attempt!);
    if (!attempts.every(isBlankAttempt) && !confirmed) { setConfirmDiscard(true); return; }
    savingRef.current = true; setSaving(true);
    try {
      for (const a of attempts) clearMarkingDraft(data.ownerId, a.id, drafts[a.id]);
      await discardAttempts(attempts.map((a) => a.id), data.ownerId);
      if (embedded && onAdvance) onAdvance({ discarded: true }); else nav(inSession ? `/session/${inSession.id}` : "/home#history", { replace: true });
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not discard this sitting."); }
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
        <div className="col-head"><span>Marking</span><span style={{ flex: 1 }} />{friends && firstQuestion && <Link className="small hl-btn button" to={`/study/${friends.record.code}?q=${Math.max(1, friends.record.questionIds.indexOf(firstQuestion.id) + 1)}`} title="See and mark your friends' answers to this set">Mark together</Link>}{forMarking?.questions.length ? <button className="small hl-btn" title="Copy the case, the questions, your answers and the model answers, to paste anywhere" onClick={copy}>{copied ? "Copied" : "Copy set"}</button> : null}{data.admin && forMarking?.questions.length && data.ownerId ? <AssistantMenu label="Mark with AI" title="Have your AI assistant mark this set through the connector; the scores and comments come back here to check and save." prompt={markPromptText} hint="Your assistant reads this set, marks each part and sends the scores and comments back. They fill in here when you return." beforeOpen={() => keepForMarking(forMarking)} /> : null}{exam ? <ExamMarking exam={exam} admin={data.admin} signedIn={!!data.ownerId} /> : null}<span className="col-head-total">{total} / {maximum}</span>{paper ? <span className="col-head-total" title="The whole exam so far, this set as it stands here">Exam {paper.score + total} / {paper.maxScore + maximum}</span> : null}</div>
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
            const fi = friends ? friends.record.questionIds.indexOf(question.id) : -1;
            const friendMarks: FriendMarks | undefined = friends && fi >= 0 ? { marks: marksOn(friends.room.marks, fi, data.ownerId), comments: commentsOn(friends.room.comments, fi, data.ownerId), people: peopleOf(friends.room.study, friends.room.shared, data.ownerId), me: data.ownerId,
              onDelete: (id) => void deleteComment(friends.record.code, id).then((room) => setFriends((f) => f && { ...f, room: { ...f.room, ...room } })).catch(() => undefined) } : undefined;
            return <MarkingBlock key={question.id} question={question} attempt={attempt} set={set} order={order} draft={draft} suggested={suggested[attempt.id]} previous={previous} previousMark={previousMark} admin={data.admin} hasMark={!!mark} stemTexts={stemTexts} friends={friendMarks} idFor={(label) => idFor(question, order, label)}
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
          {anchor.mode === "practice" && readyRows.length > 0 && <button className="small link mark-discard" disabled={saving} onClick={() => void discard()} title="Throw this sitting away; the set is unattempted again">Discard set</button>}
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
      <Link className="button" to={inSession ? `/session/${inSession.id}` : "/home#history"}>{inSession ? "Session summary" : "Back to history"}</Link>
    </div>}
    {!embedded && behind && set && bankRevision !== undefined && hasUnpublishedEdits(set) && <LibraryUpdateNotice key={set.id} setId={set.id} revision={bankRevision} />}
    <div className={embedded ? "paper mark-paper embedded" : "paper mark-paper"}>
      {sidebar}
      {body}
    </div>
    {editing && <QuickEdit question={editing} mode={editingMode} onClose={() => setEditing(null)} onDeleted={deleted} />}
    <ConfirmDialog open={confirmDiscard} title="Discard this sitting?" confirmLabel="Discard" destructive onCancel={() => setConfirmDiscard(false)} onConfirm={() => { setConfirmDiscard(false); void discard(true); }}>Your answers and marks for it go, and the set is unattempted again.</ConfirmDialog>
  </div>;
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
  /** Marks and comments friends gave this answer on Mark together. */
  friends?: FriendMarks;
  onChange: (draft: MarkingDraft) => void;
  onEdit: (question: Question) => void;
  onFocusPart: (id: string) => void;
  idFor: (label: string) => string;
}

/** One question: its parts, each with your answer, the model answer and a score. */
function MarkingBlock({ question, attempt, set, order, draft, previous, previousMark, admin, hasMark, suggested, stemTexts, friends, onChange, onEdit, onFocusPart, idFor }: BlockProps) {
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState(!!draft.notes || !!draft.learningPoint || draft.errorTags.length > 0);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  // Whether a part's model answer started folded (see isFolded below).
  const defaultFold = useRef<Record<string, boolean>>({});
  const toggle = (key: string) => setFolded((f) => ({ ...f, [key]: !(f[key] ?? defaultFold.current[key] ?? false) }));
  const patch = <K extends keyof MarkingDraft>(key: K, value: MarkingDraft[K]) => onChange({ ...draft, [key]: value });
  // A score typed for a part marks it as scored, so a deliberate nought counts as marked.
  const setPart = (label: string, change: Partial<PartMark>) => onChange({ ...draft, parts: draft.parts.map((p) => (p.label === label ? { ...p, ...change } : p)), ...(change.score !== undefined ? { scored: [...new Set([...(draft.scored ?? []), label])] } : {}) });
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
      onChange={(e) => { const raw = e.target.value; setTyping((t) => ({ ...t, [key]: raw })); setEntered((set) => new Set(set).add(key)); const n = Number(raw); if (raw !== "" && Number.isFinite(n)) apply(Math.max(0, max ? Math.min(n, max) : n)); else if (raw === "") apply(0); }}
      onBlur={() => setTyping((t) => { const { [key]: _gone, ...rest } = t; void _gone; return rest; })} />
  );
  const total = draft.parts.reduce((a, p) => a + p.score, 0);
  const max = draft.parts.reduce((a, p) => a + p.maxScore, 0);
  const flagged = draft.reviewLater || draft.lookedAtAnswer;
  // "Your answer" or the marker's full-marks rewrite of it, per part.
  const [view, setView] = useState<Record<string, "answer" | "full" | "revise">>({});
  const [clean, setClean] = useState<Record<string, boolean>>({});
  // The model answer reads as written unless the student switches a part to its tick list.
  const [asTicks, setAsTicks] = useState<Record<string, boolean>>({});
  const discardRevision = async (label: string) => {
    await db.attempts.update(attempt.id, { answers: attempt.answers.map((a) => a.label === label ? { ...a, revision: undefined } : a) });
    requestSync(); setView((v) => ({ ...v, [label]: "answer" }));
  };
  // A part's general comments from the marker are its verdict, shown with the score rather than in the margin.
  const comments = attempt.answerComments ?? [];
  const verdictsFor = (label: string) => comments.filter((c) => c.by === "marker" && c.partLabel === label && isGeneralComment(c));
  const marginComments = comments.filter((c) => !(c.by === "marker" && isGeneralComment(c)));
  // A part that arrives marked has its model answer folded; one being marked now stays open
  // while the score is typed or ticked (the first look decides, not every keystroke).
  const isFolded = (key: string, label: string) => {
    if (folded[key] !== undefined) return folded[key];
    if (defaultFold.current[key] === undefined) defaultFold.current[key] = hasMark || !!suggested?.has(label) || !!draft.scored?.includes(label);
    return defaultFold.current[key];
  };
  // Suggested marks that arrive later fold the parts they cover, unless the student has opened them.
  useEffect(() => {
    if (!suggested?.size) return;
    setFolded((f) => { const next = { ...f }; for (const label of suggested) if (next[label] === undefined && defaultFold.current[label] === false) next[label] = true; return next; });
  }, [suggested]);
  const tick = (label: string, list: NonNullable<ReturnType<typeof tickList>>, pm: PartMark, index: number) => {
    const pointsHit = pm.pointsHit.includes(index) ? pm.pointsHit.filter((i) => i !== index) : [...pm.pointsHit, index];
    setEntered((set) => new Set(set).add(`score:${label}`));
    setPart(label, { pointsHit, score: tickedScore(list, pointsHit, pm.maxScore) });
  };

  return (
    <section className="question-block mark-block" id={idFor("")} aria-label={`Question ${order + 1}`}>
      <div className="qhead">
        <span>{order + 1}</span>
        <span style={{ flex: 1 }} />
        <details className="q-menu">
          <summary aria-label={`More for question ${order + 1}`} title="Report, discussion and tools"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="19" cy="12" r="2" fill="currentColor" /></svg></summary>
          <div className="q-menu-list" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) e.currentTarget.parentElement?.removeAttribute("open"); }}>
            <QuestionCommunity key={question.id} question={question} set={set} />
            {admin && <><div className="q-menu-sep" /><div className="q-menu-label">Admin</div><FixWithClaude set={set} question={question} /><button type="button" className="small" onClick={() => onEdit(question)}>Edit question</button></>}
          </div>
        </details>
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
      {wholeModel && <ModelPanel className="whole" answer={question} folded={isFolded("whole", "")} onToggle={() => toggle("whole")} actions={admin && <button type="button" className="small link mark-model-edit" onClick={(e) => { e.stopPropagation(); onEdit(question); }}>Edit</button>} />}

      {partsInfo.map((pi) => {
        const pm = draft.parts.find((p) => p.label === pi.part.label);
        if (!pm) return null;
        const prevAns = previous?.answers.find((a) => a.label === pi.part.label);
        const id = idFor(pi.part.label);
        const label = pi.part.label;
        const verdicts = verdictsFor(label);
        const list = richAnswerDocument(pi.part) ? null : tickList(pi.part.modelAnswer);
        const showing = view[label] ?? "answer";
        // A part never answered still has a place to write one now; it is kept as a revision like any other.
        const answer: PartAnswer = pi.answer ?? { label, text: "", doc: null };
        const revised = !!answer.revision;
        const blank = !hasAnswerContent(answer);
        return (
          <div key={pi.part.label} className="part mark-part" id={id} onFocusCapture={() => onFocusPart(id)}>
            {(pi.part.text || pi.part.textDoc) ? (
              <div className="part-head">
                {pi.part.label && <span className="label">{partLabel(pi.part.label)}</span>}
                <AmbossText cacheKey={question.id} texts={texts} text={pi.part.text} doc={pi.part.textDoc} className="text marking-prompt" />
                {question.parts.length > 0 && pi.part.marks !== undefined && <span className="marks">({pi.part.marks} mark{pi.part.marks === 1 ? "" : "s"})</span>}
              </div>
            ) : null}
            <div className={"mark-verdict" + (verdicts.length || (list && asTicks[label] && !isFolded(label, label)) ? "" : " plain")}>
              <div className="mark-score">
                <label>Score</label>
                {scoreField(`score:${label}`, pm.score, (n) => setPart(label, { score: n }), pm.maxScore || undefined, `Score${label ? ` for part ${label}` : ""}`, !hasMark && !suggested?.has(label))}
                <span className="mark-score-sep">/</span>
                {scoreField(`max:${label}`, pm.maxScore, (n) => setPart(label, { maxScore: n }), undefined, `Maximum score${label ? ` for part ${label}` : ""}`)}
              </div>
              {verdicts.length ? <div className="mark-verdict-text">{verdicts.map((v) => <p key={v.id} className="pre">{v.text}</p>)}<span className="muted mark-verdict-by">Marker</span></div>
                : list && asTicks[label] && !isFolded(label, label) ? <p className="muted mark-verdict-hint">Tick the points you made below and the score follows, or type it.</p> : null}
              {friends && friends.marks.length > 0 && <div className="mark-verdict-text mt-chips" aria-label="Marks from friends"><MarkChips marks={friends.marks} people={friends.people} part={partsInfo.length > 1 ? label : undefined} firstPart={pi === partsInfo[0]} /></div>}
            </div>
            {(pm.rewrite || revised || showing !== "answer") && <div className="mark-views" role="group" aria-label="Answer view">
              <button type="button" className="small" aria-pressed={showing === "answer"} onClick={() => setView((v) => ({ ...v, [label]: "answer" }))}>Your answer</button>
              {pm.rewrite && <button type="button" className="small" aria-pressed={showing === "full"} onClick={() => setView((v) => ({ ...v, [label]: "full" }))}>Full marks</button>}
              <button type="button" className="small" aria-pressed={showing === "revise"} title="Rewrite your answer having read the model answer; what you submitted is kept as it was" onClick={() => setView((v) => ({ ...v, [label]: "revise" }))}>{revised ? (blank ? "Written" : "Revised") : blank ? "Write an answer" : "Revise"}</button>
              {showing === "full" && <span className="muted">Struck text earned nothing; teal text earns the mark.</span>}
              {(showing === "revise" || (showing === "answer" && revised)) && <span className="mark-views-tools"><button type="button" className="small link" onClick={() => setClean((c) => ({ ...c, [label]: !c[label] }))}>{clean[label] ? "Show changes" : "Hide changes"}</button>{revised && showing === "revise" && <button type="button" className="small link" onClick={() => void discardRevision(label)}>Discard</button>}</span>}
            </div>}
            {showing === "revise" ? <CommentedAnswer key={`${attempt.id}:${label}`} attemptId={attempt.id} partLabel={label} doc={answer.doc} text={answer.text} comments={marginComments} margin
                editor={({ active, onLayout }) => <RevisedAnswer key={`${attempt.id}:${label}:revise`} attemptId={attempt.id} answer={answer} clean={!!clean[label]} comments={marginComments} active={active} onLayout={onLayout} />} />
            : showing === "full" && pm.rewrite ? <div className="full-marks">
              <p className="pre">{wordDiff(pi.answer?.text ?? "", pm.rewrite).map((part, i) => part.kind === "del" ? <del key={i}>{part.text}</del> : part.kind === "ins" ? <ins key={i}>{part.text}</ins> : <span key={i}>{part.text}</span>)}</p>
              <p className="muted full-marks-note">Your own words, with the smallest changes that would earn each mark.</p>
            </div>
            : <CommentedAnswer key={`${attempt.id}:${label}`} attemptId={attempt.id} partLabel={label} doc={answer.doc} text={answer.text} comments={marginComments} margin revision={answer.revision?.text} showChanges={!clean[label]}
                actions={!pm.rewrite && !revised ? <button type="button" className="small comment-add" title={blank ? "Write an answer now; the submitted blank is kept as it was" : "Rewrite your answer having read the model answer; what you submitted is kept as it was"} onClick={() => setView((v) => ({ ...v, [label]: "revise" }))}>{blank ? "Write an answer" : "Revise"}</button> : undefined} />}
            {previous && (
              <details className="mark-previous">
                <summary>Previous attempt{previousMark ? ` (${previousMark.parts.find((p) => p.label === pi.part.label)?.score ?? "?"}/${previousMark.parts.find((p) => p.label === pi.part.label)?.maxScore ?? "?"})` : ""}</summary>
                {prevAns?.doc ? <AnswerHtml doc={prevAns.doc} /> : <p className="pre">{prevAns?.text || "No answer written."}</p>}
              </details>
            )}
            <ModelPanel answer={pi.part} list={list} asTicks={!!asTicks[label]} onAsTicks={(on) => setAsTicks((t) => ({ ...t, [label]: on }))} pointsHit={pm.pointsHit} onTick={(i) => tick(label, list!, pm, i)}
              folded={isFolded(label, label)} onToggle={() => toggle(label)} emptyText={wholeModel ? "See the model answer above." : "No model answer for this part."}
              actions={admin && <button type="button" className="small link mark-model-edit" onClick={(e) => { e.stopPropagation(); onEdit(question); }}>Edit</button>} />
          </div>
        );
      })}

      {friends && friends.comments.length > 0 && <div className="mt-comments"><FriendComments comments={friends.comments} me={friends.me} onDelete={friends.onDelete} /></div>}
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
