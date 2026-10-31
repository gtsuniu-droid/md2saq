import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { db, getSettings } from "../data/db";
import type { Question, SubPart } from "../data/types";
import AnswerHtml from "../components/AnswerHtml";
import ModelPanel from "../components/ModelPanel";
import { Face, FriendComments, MarkChips } from "../components/StudyMarks";
import { deleteComment, fetchRoom, formatCode, giveMark, postComment, resolveStudyQuestions, shareMyAnswers, studyRecord, type PeerMark, type PeerPartMark, type SharedAnswer, type StudyComment, type StudyRoomView } from "../lib/study";
import { answerAt, average, commentsOn, markedByMe, marksOn, maxFor, peopleOf, type RoomPerson } from "../lib/studyRoom";
import { tickList, tickedScore } from "../lib/markingTicks";
import { hasModelAnswer, richAnswerDocument } from "../lib/modelAnswer";
import { answerParts, partLabel, stemsOf } from "../lib/questions";
import { belongsToAccount } from "../lib/progressAccount";

const POLL_MS = 8_000;
const SAVE_DELAY_MS = 600;

/** The question's parts: the library's when the set is here, else one part shaped from the code's question. */
const partsOf = (lq: Question | undefined, marks: number | undefined): SubPart[] => lq ? answerParts(lq) : [{ label: "", text: "", marks }];

interface BlockProps {
  person: RoomPerson; answer: SharedAnswer | undefined; parts: SubPart[]; me: string; people: RoomPerson[]; max: number;
  marks: PeerMark[]; comments: StudyComment[]; myAttemptId?: string; hasLibrary: boolean;
  draft: PeerPartMark[] | undefined; onDraft: (parts: PeerPartMark[]) => void;
  onComment: (text: string) => Promise<void>; onDelete: (id: string) => void;
}

/**
 * One person's answer to the current question, marked the way the set marking page marks: a
 * score row per part, the answer as written, the model answer beneath with its tick list.
 * Your own answer shows the marks friends gave it; marking it is done on your set.
 */
function PersonBlock({ person, answer, parts, me, people, max, marks, comments, myAttemptId, hasLibrary, draft, onDraft, onComment, onDelete }: BlockProps) {
  const [commentDraft, setCommentDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [asTicks, setAsTicks] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, string>>({});
  const mine = person.uid === me;
  const myMark = marks.find((m) => m.by === me);
  const others = marks.filter((m) => m.by !== me);
  const single = parts.length === 1;
  // My marking of this answer, part by part: what I have typed here, else what I saved before.
  const partMarks: PeerPartMark[] = draft ?? parts.map((p) => myMark?.parts?.find((x) => x.label === p.label) ?? { label: p.label, score: single && myMark && !myMark.parts ? myMark.score : 0, maxScore: p.marks ?? (single ? max : 0), pointsHit: [] });
  const setPart = (label: string, change: Partial<PeerPartMark>) => onDraft(partMarks.map((p) => (p.label === label ? { ...p, ...change } : p)));
  const total = partMarks.reduce((t, p) => t + p.score, 0);
  const totalMax = partMarks.reduce((t, p) => t + p.maxScore, 0) || max;
  const send = async () => {
    if (!commentDraft.trim()) return;
    setPosting(true); setError("");
    try { await onComment(commentDraft); setCommentDraft(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not post that."); } finally { setPosting(false); }
  };
  const sharedPart = (label: string) => answer?.parts?.find((p) => p.label === label) ?? (single ? { label: "", text: answer?.text ?? "", doc: answer?.parts?.[0]?.doc } : undefined);
  return (
    <div className={`mark-part mt-person${mine ? " mine" : ""}`} aria-label={`${person.name}'s answer`}>
      <div className="mark-answer-head">
        <Face name={person.name} photo={person.photo} />
        <h4>{person.name}{mine && <span className="lb-you">you</span>}</h4>
        <span style={{ flex: 1 }} />
        {mine && myAttemptId && <Link className="small link" to={`/mark/${myAttemptId}`}>Mark your set</Link>}
      </div>
      {!answer ? <p className="muted">{mine ? "Your answer is not here yet." : "Nothing shared yet."}</p> : <>
        {mine && (
          <div className="mark-verdict plain">
            <div className="mark-score"><label>Score</label><strong className="mt-self-score">{answer.score ?? "–"}</strong><span className="mark-score-sep">/</span><span>{answer.maxScore ?? max}</span></div>
            <div className="mark-verdict-text mt-chips">{marks.length ? <><MarkChips marks={marks} people={people} />{marks.length > 1 && <span className="muted">Average {average(marks)}</span>}</> : <span className="muted">No marks from friends yet</span>}</div>
          </div>
        )}
        {parts.map((part) => {
          const sp = sharedPart(part.label);
          const pm = partMarks.find((p) => p.label === part.label)!;
          const list = hasLibrary && !richAnswerDocument(part) ? tickList(part.modelAnswer) : null;
          const key = `score:${part.label}`;
          return (
            <div key={part.label} className="mt-part">
              {!single && (part.label || part.text || part.marks !== undefined) && <div className="part-head">{part.label && <span className="label">{partLabel(part.label)}</span>}<span className="text marking-prompt pre">{part.text}</span>{part.marks !== undefined && <span className="marks">({part.marks} mark{part.marks === 1 ? "" : "s"})</span>}</div>}
              {!mine && (
                <div className={`mark-verdict${others.length ? "" : " plain"}`}>
                  <div className="mark-score">
                    <label>Score</label>
                    <input aria-label={`Your score for ${person.name}${part.label ? `, part ${part.label}` : ""}`} type="number" inputMode="decimal" min={0} max={pm.maxScore || undefined} step="any" className="score-input" placeholder="–"
                      value={typing[key] ?? (myMark || draft ? String(pm.score) : "")}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => { const raw = e.target.value; setTyping((t) => ({ ...t, [key]: raw })); const n = Number(raw); if (raw !== "" && Number.isFinite(n)) setPart(part.label, { score: Math.max(0, pm.maxScore ? Math.min(n, pm.maxScore) : n) }); }}
                      onBlur={() => setTyping((t) => { const { [key]: _gone, ...rest } = t; void _gone; return rest; })} />
                    <span className="mark-score-sep">/</span>
                    {pm.maxScore ? <span>{pm.maxScore}</span> : <input aria-label="Maximum score" type="number" inputMode="decimal" min={0} step="any" className="score-input" value={pm.maxScore || ""} onChange={(e) => setPart(part.label, { maxScore: Math.max(0, Number(e.target.value) || 0) })} />}
                  </div>
                  {others.length > 0 && <div className="mark-verdict-text mt-chips"><MarkChips marks={others} people={people} part={single ? undefined : part.label} firstPart={part === parts[0]} /></div>}
                </div>
              )}
              {sp?.doc ? <AnswerHtml doc={sp.doc} /> : <p className="pre mt-answer-text">{sp?.text || "No answer written."}</p>}
              {!mine && hasLibrary && (
                <ModelPanel answer={part} list={list} asTicks={!!asTicks[part.label]} onAsTicks={(on) => setAsTicks((t) => ({ ...t, [part.label]: on }))} pointsHit={pm.pointsHit}
                  onTick={(i) => { const pointsHit = pm.pointsHit.includes(i) ? pm.pointsHit.filter((x) => x !== i) : [...pm.pointsHit, i]; setPart(part.label, { pointsHit, score: tickedScore(list!, pointsHit, pm.maxScore) }); }}
                  folded={folded[part.label] ?? false} onToggle={() => setFolded((f) => ({ ...f, [part.label]: !(f[part.label] ?? false) }))} />
              )}
            </div>
          );
        })}
        {!mine && !single && <div className="mt-total"><strong>{total} / {totalMax}</strong></div>}
      </>}
      <div className="mt-comments">
        <FriendComments comments={comments} me={me} onDelete={onDelete} />
        <form className="mt-comment-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input type="text" value={commentDraft} maxLength={1000} placeholder="Comment" aria-label={mine ? "Comment on your own answer" : `Comment on ${person.name}'s answer`} onChange={(e) => setCommentDraft(e.target.value)} />
          {commentDraft.trim() && <button type="submit" className="small primary" disabled={posting}>{posting ? "…" : "Post"}</button>}
        </form>
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}

/**
 * Mark a study session's answers together, on the same marking page as a set of your own: the
 * case on the left, each person's answer on the right with the model answer and a score under
 * it, one question at a time. Marks and comments reach everyone in the session.
 */
export default function StudyPage() {
  const { code = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const settings = useLiveQuery(getSettings, []);
  const [room, setRoom] = useState<StudyRoomView | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [local, setLocal] = useState<(Question | undefined)[]>([]);
  const [myAttempts, setMyAttempts] = useState<(string | undefined)[]>([]);
  const localLoaded = useRef(false);
  const [mine, setMine] = useState<"pending" | "shared" | "none" | "no-record" | "error">("pending");
  const [wholeFolded, setWholeFolded] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PeerPartMark[]>>({});
  const me = settings?.cloudUser?.uid;
  const roomRef = useRef(room);
  roomRef.current = room;
  // Marks typed here save a moment after the last change; what is waiting to save, by question and person.
  const timers = useRef<Record<string, number>>({});
  const pending = useRef<Record<string, () => void>>({});
  // When this device last changed the room, so a poll that set out before then cannot undo it.
  const lastChange = useRef(0);

  /** Fresh marks and comments from a reply replace ours; the answers only when a whole room came back. */
  const take = useCallback((next: Pick<StudyRoomView, "marks" | "comments"> & Partial<StudyRoomView>) => {
    lastChange.current = Date.now();
    setRoom((cur) => {
      if ("study" in next && next.study) return next as StudyRoomView;
      return cur ? { ...cur, marks: next.marks, comments: next.comments } : cur;
    });
  }, []);

  const refresh = useCallback(async (share: boolean) => {
    const started = Date.now();
    // A reply that set out before a mark or comment was made here keeps this device's marks and comments.
    const apply = (fresh: StudyRoomView | null) => setRoom((cur) => fresh && cur && started < lastChange.current ? { ...fresh, marks: cur.marks, comments: cur.comments } : fresh);
    let shareFailed = false;
    try {
      let record = null;
      if (share) {
        record = await studyRecord(code);
        if (!record) setMine("no-record");
        else {
          if (!localLoaded.current) {
            localLoaded.current = true;
            setLocal(await db.questions.bulkGet(record.questionIds));
            const uid = (await getSettings()).cloudUser?.uid ?? "";
            const since = record.startedAt - 60_000;
            const attempts = (await db.attempts.where("questionId").anyOf(record.questionIds).toArray()).filter((a) => belongsToAccount(a, uid) && a.submittedAt !== undefined && a.startedAt >= since).sort((a, b) => b.submittedAt! - a.submittedAt!);
            setMyAttempts(record.questionIds.map((qid) => attempts.find((a) => a.questionId === qid)?.id));
          }
          try {
            const posted = await shareMyAnswers(code);
            setMine(posted ? "shared" : "none");
            if (posted) { apply(posted); setError(""); return; }
          } catch (e) { shareFailed = true; setMine("error"); setError(e instanceof Error ? e.message : "Could not share your answers."); }
        }
      }
      const fresh = await fetchRoom(code);
      apply(fresh);
      if (!shareFailed) setError("");
      // Without a record of sitting the code, the set may still be in the library: then the case and model answers show.
      if (fresh && share && !record && !localLoaded.current) {
        localLoaded.current = true;
        try { setLocal(await db.questions.bulkGet(await resolveStudyQuestions(fresh.study))); } catch { /* not in this library */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this session.");
      if (roomRef.current === undefined) setRoom(null);
    }
  }, [code]);

  /** Save every mark still waiting, now. */
  const flushPending = useCallback(() => {
    for (const key of Object.keys(pending.current)) { window.clearTimeout(timers.current[key]); const run = pending.current[key]; delete pending.current[key]; run(); }
  }, []);
  useEffect(() => flushPending, [flushPending]);

  useEffect(() => {
    if (!me) return;
    void refresh(true);
    const tick = () => { if (document.visibilityState === "visible") void refresh(false); };
    const timer = window.setInterval(tick, POLL_MS);
    const back = () => { if (document.visibilityState === "visible") void refresh(true); };
    document.addEventListener("visibilitychange", back);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", back); };
  }, [code, me, refresh]);

  const people = useMemo(() => room ? peopleOf(room.study, room.shared, me) : [], [room, me]);
  const count = room?.study.questions.length ?? 0;
  const index = Math.min(Math.max(0, Number(params.get("q") ?? 1) - 1 || 0), Math.max(0, count - 1));
  const go = (i: number) => { flushPending(); const next = new URLSearchParams(params); next.set("q", String(i + 1)); setParams(next, { replace: true }); setDrafts({}); document.querySelector(".mark-answers")?.scrollTo({ top: 0 }); };

  /** A typed or ticked mark saves itself a moment after the last change, as the room's copy. */
  const draftFor = (targetUid: string, parts: PeerPartMark[]) => {
    if (!me || !room) return;
    setDrafts((d) => ({ ...d, [targetUid]: parts }));
    const score = parts.reduce((t, p) => t + p.score, 0);
    const maxScore = parts.reduce((t, p) => t + p.maxScore, 0);
    lastChange.current = Date.now();
    setRoom((cur) => cur ? { ...cur, marks: [...cur.marks.filter((m) => !(m.index === index && m.targetUid === targetUid && m.by === me)), { index, targetUid, by: me, score, maxScore, parts, at: Date.now() }] } : cur);
    const key = `${index}:${targetUid}`;
    window.clearTimeout(timers.current[key]);
    pending.current[key] = () => { void giveMark(code, index, targetUid, score, maxScore, parts).then(take).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not save that mark.")); };
    timers.current[key] = window.setTimeout(() => { const run = pending.current[key]; delete pending.current[key]; run?.(); }, SAVE_DELAY_MS);
  };

  if (!settings) return null;
  if (!me) return <div className="mt-plain"><h1>Mark together</h1><p className="muted">Sign in to mark a study session with friends.</p></div>;
  if (room === undefined) return <div className="mt-plain"><p className="muted page-loading" role="status">Loading…</p></div>;
  if (!room) return <div className="mt-plain"><h1>Mark together</h1><p className="field-error">{error || "No session has that code."}</p><Link to="/home">Back to home</Link></div>;

  const { study } = room;
  const q = study.questions[index];
  const lq = local[index];
  const parts = partsOf(lq, q.marks);
  const stems = lq ? stemsOf(lq) : [];
  const wholeModel = !!lq && lq.parts.length > 0 && hasModelAnswer(lq) && (!!richAnswerDocument(lq) || !lq.parts.some(hasModelAnswer));
  const myAttemptId = myAttempts[index];

  return (
    <div className="set-marking mark-together">
      <div className="paper-top">
        <span className="paper-status mt-status">
          <span className="paper-mode">Marking together</span>
          <span className="mt-code">{formatCode(study.code)}</span>
          <span className="mt-faces" title={people.map((p) => `${p.name}${p.shared ? " (shared)" : ""}`).join(", ")} role="img" aria-label={`${people.filter((p) => p.shared).length} of ${people.length} shared`}>
            {people.slice(0, 8).map((p) => <Face key={p.uid} name={p.name} photo={p.photo} small shared={!!p.shared} />)}
          </span>
        </span>
        <span style={{ flex: 1 }} />
        {mine === "no-record" && <span className="muted mt-notice">Sit this code from your home page and your answers join.</span>}
        {mine === "none" && <span className="muted mt-notice">Submit a question and your answers join.</span>}
        {error && <span className="field-error" role="alert">{error}</span>}
        <Link className="button" to={myAttemptId ? `/mark/${myAttemptId}` : "/home#history"}>{myAttemptId ? "Your set" : "Back to history"}</Link>
      </div>
      <div className="paper mark-paper">
        <nav className="paper-side mark-side" aria-label="Questions">
          {study.questions.map((_, i) => {
            const done = markedByMe(people, room.marks, i, me);
            return <button key={i} type="button" className={(i === index ? "current" : "") + (done ? " done" : "")} aria-current={i === index ? "page" : undefined} onClick={() => go(i)}><span>{i + 1}</span>{done && <span className="mark-side-score" aria-label="Marked">✓</span>}</button>;
          })}
        </nav>
        <div className="paper-split mark-split">
          <div className="paper-stem">
            <div className="col-head"><span>Case stem</span></div>
            {stems.map((s, i) => <div key={i} className="stem-block"><p className="pre">{s}</p></div>)}
            {(lq?.images ?? []).filter((im) => im.place === "stem").map((im) => <figure key={im.id} className="qimg"><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption className="muted">{im.caption}</figcaption>}</figure>)}
            {!lq && <div className="muted">The case appears once this set is in your library.</div>}
            {lq && !stems.length && <div className="muted">No case stem.</div>}
          </div>
          <div className="paper-answers mark-answers">
            <div className="col-head"><span>Marking</span><span style={{ flex: 1 }} /><span className="col-head-total">{index + 1} / {count}</span></div>
            <section className="question-block mark-block" aria-label={`Question ${index + 1}`}>
              <div className="qhead"><span>{index + 1}</span></div>
              {(lq ? lq.text : q.text) && <div className="part-head" style={{ marginBottom: ".8rem" }}>
                <span className="text marking-prompt pre">{lq ? lq.text : q.text}</span>
                {parts.length === 1 && (lq?.marks ?? q.marks) !== undefined && <span className="marks">({lq?.marks ?? q.marks} mark{(lq?.marks ?? q.marks) === 1 ? "" : "s"})</span>}
              </div>}
              {(lq?.images ?? []).filter((im) => im.place === "question").map((im) => <figure key={im.id} className="qimg"><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption className="muted">{im.caption}</figcaption>}</figure>)}
              {wholeModel && lq && <ModelPanel className="whole" answer={lq} folded={wholeFolded} onToggle={() => setWholeFolded((f) => !f)} />}
              {people.map((p) => {
                const answer = answerAt(p, index);
                // Without the set in this library, an answer in parts still reads part by part.
                const personParts: SubPart[] = lq ? parts : (answer?.parts && answer.parts.length > 1 ? answer.parts.map((sp) => ({ label: sp.label, text: "" })) : parts);
                return <PersonBlock key={`${index}:${p.uid}`} person={p} answer={answer} parts={personParts} me={me} people={people} max={maxFor(q, answer)} hasLibrary={!!lq}
                  marks={marksOn(room.marks, index, p.uid)} comments={commentsOn(room.comments, index, p.uid)} myAttemptId={p.uid === me ? myAttemptId : undefined}
                  draft={drafts[p.uid]} onDraft={(partsDraft) => draftFor(p.uid, partsDraft)}
                  onComment={async (text) => take(await postComment(code, index, p.uid, text))}
                  onDelete={(id) => void deleteComment(code, id).then(take).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not remove that comment."))} />;
              })}
              <div className="mark-question-foot mt-foot">
                <button type="button" className="small" onClick={() => go(index - 1)} disabled={index === 0}>Previous</button>
                <span style={{ flex: 1 }} />
                <button type="button" className="small primary" onClick={() => go(index + 1)} disabled={index >= count - 1}>Next question</button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
