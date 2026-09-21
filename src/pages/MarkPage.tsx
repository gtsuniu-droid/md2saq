import { belongsToAccount } from "../lib/progressAccount";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { db, newId } from "../data/db";
import { ERROR_TAGS, type ErrorTag, type Mark, type PartMark } from "../data/types";
import AnswerHtml from "../components/AnswerHtml";
import { answerParts, formatDuration, partLabel, stemsOf } from "../lib/questions";
import { loadSession, saveSession } from "../lib/session";
import AmbossText from "../components/AmbossText";
import QuickEdit from "../components/QuickEdit";
import { isAdmin } from "../lib/admin";
import { getSettings } from "../data/db";
import { questionRef, requestSync } from "../lib/sync";
import AutoTextarea from "../components/AutoTextarea";
import ModelAnswerContent from "../components/ModelAnswerContent";
import { hasModelAnswer, richAnswerDocument } from "../lib/modelAnswer";
import { sessionAtQuestion } from "../lib/sessionNavigation";

export default function MarkPage() {
  const { attemptId = "" } = useParams();
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const ownerId = (await getSettings()).cloudUser?.uid ?? "";
    const attempt = await db.attempts.get(attemptId);
    if (!attempt || !belongsToAccount(attempt, ownerId)) return null;
    const question = await db.questions.get(attempt.questionId);
    if (!question) return null;
    const set = await db.sets.get(question.setId);
    const existing = await db.marks.where("attemptId").equals(attemptId).filter((m) => belongsToAccount(m, ownerId)).first();
    const attemptsBefore = (await db.attempts.where("questionId").equals(question.id).toArray())
      .filter((a) => belongsToAccount(a, ownerId) && a.submittedAt !== undefined && a.id !== attemptId)
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
    const previous = attemptsBefore[0];
    const previousMark = previous ? await db.marks.where("attemptId").equals(previous.id).filter((m) => belongsToAccount(m, ownerId)).first() : undefined;
    const sessionAttempts = attempt.sessionId ? await db.attempts.where("sessionId").equals(attempt.sessionId).filter((a) => belongsToAccount(a, ownerId)).toArray() : [attempt];
    const stemHighlights = sessionAttempts.flatMap((a) => a.stemHighlights ?? []);
    const session = loadSession(ownerId);
    const position = session?.attemptIds.indexOf(attemptId) ?? -1;
    const nextId = position >= 0 ? session?.questionIds[position + 1] : undefined;
    const nextQuestion = nextId ? await db.questions.get(nextId) : undefined;
    return { attempt, question, existing, previous, previousMark, stemHighlights, set, nextQuestion };
  }, [attemptId]);

  const [confidence, setConfidence] = useState<number | undefined>();
  const [parts, setParts] = useState<PartMark[]>([]);
  const [errorTags, setErrorTags] = useState<ErrorTag[]>([]);
  const [reflection, setReflection] = useState("");
  const [learningPoint, setLearningPoint] = useState("");
  const [notes, setNotes] = useState("");
  const [seeded, setSeeded] = useState("");
  const [editing, setEditing] = useState(false);
  const admin = useLiveQuery(async () => isAdmin(await getSettings()), []) ?? false;

  const partsInfo = useMemo(() => {
    if (!data) return [];
    return answerParts(data.question).map((p) => {
      const answer = data.attempt.answers.find((a) => a.label === p.label);
      return { part: p, answer };
    });
  }, [data]);

  useEffect(() => {
    if (!data || data.attempt.id !== attemptId || seeded === attemptId) return;
    setConfidence(data.attempt.confidence);
    if (data.existing) {
      setParts(data.existing.parts);
      setErrorTags(data.existing.errorTags);
      setReflection(data.existing.reflection ?? "");
      setLearningPoint(data.existing.learningPoint ?? "");
      setNotes(data.existing.notes ?? "");
    } else {
      setErrorTags([]); setReflection(""); setLearningPoint(""); setNotes("");
      setParts(partsInfo.map((pi) => ({ label: pi.part.label, score: 0, maxScore: pi.part.marks ?? 0, pointsHit: [] })));
    }
    setSeeded(attemptId);
  }, [data, partsInfo, seeded, attemptId]);

  if (data === undefined) return null;
  if (data === null) return <p>Attempt not found.</p>;
  const { attempt, question, existing } = data;

  const hasModel = hasModelAnswer(question) || partsInfo.some((pi) => hasModelAnswer(pi.part));
  const ambossTexts = [...stemsOf(question), question.text, ...question.parts.map((p) => p.text), ...partsInfo.map((pi) => pi.part.modelAnswer ?? "")];
  const needsConfidence = hasModel && confidence === undefined && !existing;
  const wholeModel = question.parts.length > 0 && hasModelAnswer(question) && (richAnswerDocument(question) || !question.parts.some(hasModelAnswer));

  const setPart = (label: string, patch: Partial<PartMark>) =>
    setParts((ps) => ps.map((p) => (p.label === label ? { ...p, ...patch } : p)));

  const total = parts.reduce((a, p) => a + p.score, 0);
  const max = parts.reduce((a, p) => a + p.maxScore, 0);

  const session = loadSession();
  const inSession = session?.attemptIds.includes(attempt.id) ? session : null;

  const save = async () => {
    const mark: Mark = {
      id: existing?.id ?? newId(),
      attemptId: attempt.id,
      ownerId: attempt.ownerId ?? "",
      questionId: question.id,
      qref: existing?.qref ?? (await questionRef(question)),
      score: total,
      maxScore: max,
      parts,
      errorTags,
      reflection: reflection.trim() || undefined,
      learningPoint: learningPoint.trim() || undefined,
      notes: notes.trim() || undefined,
      markedAt: Date.now(),
    };
    await db.marks.put(mark);
    requestSync();
    if (inSession) {
      if (inSession.mode === "exam") {
        nav(`/session/${inSession.id}`);
        return;
      }
      const nextIndex = inSession.attemptIds.indexOf(attempt.id) + 1;
      if (nextIndex < inSession.questionIds.length) {
        const questions = (await db.questions.bulkGet(inSession.questionIds)).filter((q) => q !== undefined);
        saveSession(sessionAtQuestion(inSession, questions, nextIndex));
        const nextAttempt = await db.attempts.get(inSession.attemptIds[nextIndex]);
        nav(nextAttempt?.submittedAt !== undefined ? `/mark/${nextAttempt.id}` : "/paper");
        return;
      }
      nav(`/session/${inSession.id}`);
      return;
    }
    nav(`/question/${question.id}`);
  };

  const editor = editing ? (
    <QuickEdit
      question={question}
      onClose={() => setEditing(false)}
      onDeleted={() => {
        // The attempt being marked went with the question.
        const rest = loadSession();
        if (!inSession) nav(`/set/${question.setId}`, { replace: true });
        else if (!rest) nav("/", { replace: true });
        else if (rest.mode === "practice") nav("/paper", { replace: true });
        else nav(`/session/${rest.id}`, { replace: true });
      }}
    />
  ) : null;

  if (needsConfidence) {
    return (
      <div>
        <h1>Before you see the model answer</h1>
        <p>How confident are you in this answer?</p>
        <div className="row confidence">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={async () => { await db.attempts.update(attempt.id, { confidence: n }); setConfidence(n); }}>{n}</button>
          ))}
        </div>
        <p className="muted">1 = guessing, 5 = certain. This is compared against your score later.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Mark</h1>
        <span className="muted row">
          {formatDuration(attempt.elapsedSec)}, {attempt.mode}{confidence !== undefined ? `, confidence ${confidence}/5` : ""}, <Link to={`/question/${question.id}`}>question</Link>
          {admin && <button className="small" onClick={() => setEditing(true)} title="Edit this question and its model answer (admin)">Edit</button>}
        </span>
      </div>
      <div className="card" style={{ margin: "0.8rem 0" }}>
        {stemsOf(question).length > 0 && (
          <details style={{ marginBottom: "0.5rem" }}>
            <summary className="muted" style={{ cursor: "pointer" }}>Case stems ({stemsOf(question).length})</summary>
            {stemsOf(question).map((st, si) => (
              <div key={si} className="stem-block">
                <AmbossText cacheKey={question.id} texts={ambossTexts} text={st} highlights={data.stemHighlights.filter((h) => h.stem === si)} />
              </div>
            ))}
          </details>
        )}
        {(question.images ?? []).map((im) => (
          <figure key={im.id} className="qimg"><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption className="muted">{im.caption}</figcaption>}</figure>
        ))}
        <AmbossText cacheKey={question.id} texts={ambossTexts} text={question.text} />
      </div>
      {data.set?.markingNotes && (
        <details className="muted" style={{ marginBottom: "0.8rem" }}>
          <summary style={{ cursor: "pointer" }}>Marking notes for this paper</summary>
          <div className="pre" style={{ marginTop: "0.3rem" }}>{data.set.markingNotes}</div>
        </details>
      )}
      {wholeModel && (
        <div className="card" style={{ marginBottom: "0.8rem" }}>
          <strong>Model answer</strong>
          <ModelAnswerContent answer={question} />
        </div>
      )}

      {partsInfo.map((pi) => {
        const pm = parts.find((p) => p.label === pi.part.label);
        if (!pm) return null;
        const prevAns = data.previous?.answers.find((a) => a.label === pi.part.label);
        return (
          <div key={pi.part.label} className="card" style={{ marginBottom: "0.8rem" }}>
            {pi.part.text && (
              <div className="part-head">
                {pi.part.label && <span className="label">{partLabel(pi.part.label)}</span>}
                <AmbossText cacheKey={question.id} texts={ambossTexts} text={pi.part.text} className="text" />
              </div>
            )}
            <div className="two-col">
              <div>
                <h3>Your answer</h3>
                <AnswerHtml doc={pi.answer?.doc} />
                {data.previous && (
                  <details style={{ marginTop: "0.5rem" }}>
                    <summary className="muted" style={{ cursor: "pointer" }}>
                      Previous attempt{data.previousMark ? ` (${data.previousMark.parts.find((p) => p.label === pi.part.label)?.score ?? "?"}/${data.previousMark.parts.find((p) => p.label === pi.part.label)?.maxScore ?? "?"})` : ""}
                    </summary>
                    <AnswerHtml doc={prevAns?.doc} />
                  </details>
                )}
              </div>
              <div>
                <h3>Marking guide</h3>
                {hasModelAnswer(pi.part) ? <ModelAnswerContent answer={pi.part} /> : <p className="muted">{wholeModel ? "Refer to the model answer above and enter your score below." : "No model answer for this part. Enter your score below."}</p>}
                <div className="row" style={{ marginTop: "0.6rem" }}>
                  <label style={{ margin: 0 }}>Score</label>
                  <input aria-label={`Score${pi.part.label ? ` for part ${pi.part.label}` : ""}`} type="number" min={0} max={pm.maxScore || undefined} value={pm.score} onChange={(e) => setPart(pi.part.label, { score: Number(e.target.value) })} />
                  <span>/</span>
                  <input aria-label={`Maximum score${pi.part.label ? ` for part ${pi.part.label}` : ""}`} type="number" min={0} value={pm.maxScore} onChange={(e) => setPart(pi.part.label, { maxScore: Number(e.target.value) })} />
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {data.set?.debrief && (
        <details className="muted" style={{ marginBottom: "0.8rem" }}>
          <summary style={{ cursor: "pointer" }}>Debrief: common errors, clinical thinking, references</summary>
          <div className="pre" style={{ marginTop: "0.3rem" }}>{data.set.debrief}</div>
        </details>
      )}
      <div className="card stack">
        <div className="row spread">
          <strong>Total {total} / {max}</strong>
        </div>
        <div>
          <label>What went wrong</label>
          {ERROR_TAGS.map((t) => (
            <span key={t.id} className={"chip" + (errorTags.includes(t.id) ? " on" : "")}
              onClick={() => setErrorTags((ts) => (ts.includes(t.id) ? ts.filter((x) => x !== t.id) : [...ts, t.id]))}>
              {t.label}
            </span>
          ))}
        </div>
        <div>
          <label>What would I do differently?</label>
          <input type="text" style={{ width: "100%" }} value={reflection} onChange={(e) => setReflection(e.target.value)} />
        </div>
        <div>
          <label>Learning point (exported to Anki)</label>
          <input type="text" style={{ width: "100%" }} value={learningPoint} onChange={(e) => setLearningPoint(e.target.value)} />
        </div>
        <div>
          <label>Notes</label>
          <AutoTextarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: "3rem" }} />
        </div>
        <div className="row">
          <button className="primary" onClick={save}>
            {inSession?.mode === "practice"
              ? inSession.attemptIds.indexOf(attempt.id) < inSession.questionIds.length - 1 ? inSession.studyUnit === "sets" && data.nextQuestion?.setId !== question.setId ? "Save and next set" : "Save and next question" : "Save and finish"
              : "Save mark"}
          </button>
        </div>
      </div>
      {editor}
    </div>
  );
}
