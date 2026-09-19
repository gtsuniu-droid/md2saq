import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { db, newId } from "../data/db";
import { ERROR_TAGS, type ErrorTag, type Mark, type PartMark } from "../data/types";
import AnswerHtml from "../components/AnswerHtml";
import { hitTerms, markingPoints } from "../lib/marking";
import { answerParts, formatDuration, partLabel, stemsOf } from "../lib/questions";
import { loadSession, saveSession } from "../lib/session";
import AmbossText from "../components/AmbossText";

export default function MarkPage() {
  const { attemptId = "" } = useParams();
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const attempt = await db.attempts.get(attemptId);
    if (!attempt) return null;
    const question = await db.questions.get(attempt.questionId);
    if (!question) return null;
    const set = await db.sets.get(question.setId);
    const existing = await db.marks.where("attemptId").equals(attemptId).first();
    const attemptsBefore = (await db.attempts.where("questionId").equals(question.id).toArray())
      .filter((a) => a.submittedAt !== undefined && a.id !== attemptId)
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
    const previous = attemptsBefore[0];
    const previousMark = previous ? await db.marks.where("attemptId").equals(previous.id).first() : undefined;
    const sessionAttempts = attempt.sessionId ? await db.attempts.where("sessionId").equals(attempt.sessionId).toArray() : [attempt];
    const stemHighlights = sessionAttempts.flatMap((a) => a.stemHighlights ?? []);
    return { attempt, question, existing, previous, previousMark, stemHighlights, set };
  }, [attemptId]);

  const [confidence, setConfidence] = useState<number | undefined>();
  const [parts, setParts] = useState<PartMark[]>([]);
  const [errorTags, setErrorTags] = useState<ErrorTag[]>([]);
  const [reflection, setReflection] = useState("");
  const [learningPoint, setLearningPoint] = useState("");
  const [notes, setNotes] = useState("");
  const [seeded, setSeeded] = useState(false);

  const partsInfo = useMemo(() => {
    if (!data) return [];
    return answerParts(data.question).map((p) => {
      const model = p.modelAnswer ?? (data.question.parts.length === 0 ? data.question.modelAnswer : undefined);
      const points = model ? markingPoints(model) : [];
      const answer = data.attempt.answers.find((a) => a.label === p.label);
      return { part: p, model, points, answer, hits: hitTerms(answer?.text ?? "", points) };
    });
  }, [data]);

  useEffect(() => {
    if (!data || seeded) return;
    setConfidence(data.attempt.confidence);
    if (data.existing) {
      setParts(data.existing.parts);
      setErrorTags(data.existing.errorTags);
      setReflection(data.existing.reflection ?? "");
      setLearningPoint(data.existing.learningPoint ?? "");
      setNotes(data.existing.notes ?? "");
    } else {
      setParts(partsInfo.map((pi) => ({ label: pi.part.label, score: 0, maxScore: pi.part.marks ?? pi.points.length, pointsHit: [] })));
    }
    setSeeded(true);
  }, [data, partsInfo, seeded]);

  if (data === undefined) return null;
  if (data === null) return <p>Attempt not found.</p>;
  const { attempt, question, existing } = data;

  const hasModel = partsInfo.some((pi) => pi.points.length > 0);
  const ambossTexts = [...stemsOf(question), question.text, ...question.parts.map((p) => p.text), ...partsInfo.flatMap((pi) => pi.points)];
  const needsConfidence = hasModel && confidence === undefined && !existing;
  const wholeModel = question.parts.length > 0 && question.modelAnswer && !question.parts.some((p) => p.modelAnswer);

  const setPart = (label: string, patch: Partial<PartMark>) =>
    setParts((ps) => ps.map((p) => (p.label === label ? { ...p, ...patch } : p)));

  const togglePoint = (label: string, idx: number, totalPoints: number) => {
    const pm = parts.find((p) => p.label === label);
    if (!pm) return;
    const hit = pm.pointsHit.includes(idx) ? pm.pointsHit.filter((i) => i !== idx) : [...pm.pointsHit, idx];
    let score = pm.score;
    if (pm.maxScore > 0 && totalPoints > 0) {
      score = totalPoints <= pm.maxScore ? Math.min(pm.maxScore, hit.length) : Math.round((hit.length / totalPoints) * pm.maxScore);
    }
    setPart(label, { pointsHit: hit, score });
  };

  const total = parts.reduce((a, p) => a + p.score, 0);
  const max = parts.reduce((a, p) => a + p.maxScore, 0);

  const session = loadSession();
  const inSession = session?.attemptIds.includes(attempt.id) ? session : null;

  const save = async () => {
    const mark: Mark = {
      id: existing?.id ?? newId(),
      attemptId: attempt.id,
      questionId: question.id,
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
    if (inSession) {
      if (inSession.mode === "exam") {
        nav(`/session/${inSession.id}`);
        return;
      }
      const nextIndex = inSession.attemptIds.indexOf(attempt.id) + 1;
      if (nextIndex < inSession.questionIds.length) {
        saveSession({ ...inSession, index: nextIndex });
        nav("/paper");
        return;
      }
      saveSession(null);
    }
    nav(`/question/${question.id}`);
  };

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
        <span className="muted">
          {formatDuration(attempt.elapsedSec)}, {attempt.mode}{confidence !== undefined ? `, confidence ${confidence}/5` : ""}, <Link to={`/question/${question.id}`}>question</Link>
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
          <div className="pre">{question.modelAnswer}</div>
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
                <AnswerHtml doc={pi.answer?.doc} hits={pi.hits} />
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
                <h3>{pi.points.length ? "Marking points" : "Model answer"}</h3>
                {pi.points.length > 0 ? (
                  <div className="points">
                    {pi.points.map((pt, idx) => (
                      <label key={idx}>
                        <input type="checkbox" checked={pm.pointsHit.includes(idx)} onChange={() => togglePoint(pi.part.label, idx, pi.points.length)} />
                        <AmbossText cacheKey={question.id} texts={ambossTexts} text={pt} className="" />
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No model answer for this part. Score it yourself.</p>
                )}
                <div className="row" style={{ marginTop: "0.6rem" }}>
                  <label style={{ margin: 0 }}>Score</label>
                  <input type="number" min={0} max={pm.maxScore || undefined} value={pm.score} onChange={(e) => setPart(pi.part.label, { score: Number(e.target.value) })} />
                  <span>/</span>
                  <input type="number" min={0} value={pm.maxScore} onChange={(e) => setPart(pi.part.label, { maxScore: Number(e.target.value) })} />
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
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: "3rem" }} />
        </div>
        <div className="row">
          <button className="primary" onClick={save}>
            {inSession?.mode === "practice" && inSession.attemptIds.indexOf(attempt.id) < inSession.questionIds.length - 1 ? "Save and next question" : "Save mark"}
          </button>
        </div>
      </div>
    </div>
  );
}
