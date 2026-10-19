import { useState } from "react";
import QuestionCommunity from "./QuestionCommunity";
import CommentedAnswer from "./CommentedAnswer";
import AnswerHtml from "./AnswerHtml";
import AmbossText from "./AmbossText";
import AutoTextarea from "./AutoTextarea";
import ModelAnswerContent from "./ModelAnswerContent";
import { ERROR_TAGS, type Attempt, type Mark, type Question, type QuestionSet, type PartMark } from "../data/types";
import { answerParts, partLabel, stemsOf } from "../lib/questions";
import { hasModelAnswer, richAnswerDocument } from "../lib/modelAnswer";
import type { MarkingDraft } from "../lib/markingSet";

interface Props {
  question: Question;
  attempt: Attempt;
  set?: QuestionSet;
  draft: MarkingDraft;
  previous?: Attempt;
  previousMark?: Mark;
  admin: boolean;
  onChange: (draft: MarkingDraft) => void;
  onEdit: (question: Question) => void;
}

export default function MarkingQuestion({ question, attempt, set, draft, previous, previousMark, admin, onChange, onEdit }: Props) {
  const { confidence, parts, errorTags, learningPoint, notes, reviewLater, lookedAtAnswer } = draft;
  const patch = <K extends keyof MarkingDraft>(key: K, value: MarkingDraft[K]) => onChange({ ...draft, [key]: value });
  const setConfidence = (value: number | undefined) => patch("confidence", value);
  const setParts = (value: PartMark[]) => patch("parts", value);
  const setErrorTags = (value: MarkingDraft["errorTags"]) => patch("errorTags", value);
  const setLearningPoint = (value: string) => patch("learningPoint", value);
  const setNotes = (value: string) => patch("notes", value);
  const setReviewLater = (value: boolean) => patch("reviewLater", value);
  const partsInfo = answerParts(question).map((part) => ({ part, answer: attempt.answers.find((a) => a.label === part.label) }));
  const ambossTexts = [...stemsOf(question), question.text, ...question.parts.map((p) => p.text), ...partsInfo.map((pi) => pi.part.modelAnswer ?? "")];
  const wholeModel = question.parts.length > 0 && hasModelAnswer(question) && (richAnswerDocument(question) || !question.parts.some(hasModelAnswer));

  const setPart = (label: string, patch: Partial<PartMark>) => {
    setParts(parts.map((p) => (p.label === label ? { ...p, ...patch } : p)));
  };
  // What is typed in a score box, so it can be cleared and retyped without a leading 0 sticking around.
  const [typing, setTyping] = useState<Record<string, string>>({});
  const scoreField = (key: string, value: number, patch: (n: number) => void, max?: number, ariaLabel?: string) => (
    <input aria-label={ariaLabel} type="number" inputMode="decimal" min={0} max={max} step="any" className="score-input"
      value={typing[key] ?? String(value)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => { const raw = e.target.value; setTyping((t) => ({ ...t, [key]: raw })); const n = Number(raw); if (raw !== "" && Number.isFinite(n)) patch(Math.max(0, n)); else if (raw === "") patch(0); }}
      onBlur={() => setTyping((t) => { const { [key]: _gone, ...rest } = t; void _gone; return rest; })} />
  );

  const total = parts.reduce((a, p) => a + p.score, 0);
  const max = parts.reduce((a, p) => a + p.maxScore, 0);

  return (
    <section className="mark-question" aria-label={`Question ${question.order + 1}`}>
      <div className="row spread">
        <h2>Question {question.order + 1}</h2>
        <div className="row">
          <QuestionCommunity key={question.id} question={question} set={set} />
          {admin && <button className="small" onClick={() => onEdit(question)}>Edit</button>}
        </div>
      </div>
      <div className="card" style={{ margin: "0.8rem 0" }}>
        {(question.images ?? []).map((im) => (
          <figure key={im.id} className="qimg"><img src={im.dataUrl} alt={im.caption ?? ""} />{im.caption && <figcaption className="muted">{im.caption}</figcaption>}</figure>
        ))}
        <AmbossText cacheKey={question.id} texts={ambossTexts} text={question.text} doc={question.textDoc} className="pre marking-prompt" />
      </div>
      {wholeModel && (
        <div className="card" style={{ marginBottom: "0.8rem" }}>
          <strong>Model answer</strong>
          <ModelAnswerContent answer={question} />
        </div>
      )}

      {partsInfo.map((pi) => {
        const pm = parts.find((p) => p.label === pi.part.label);
        if (!pm) return null;
        const prevAns = previous?.answers.find((a) => a.label === pi.part.label);
        return (
          <div key={pi.part.label} className="card" style={{ marginBottom: "0.8rem" }}>
            {(pi.part.text || pi.part.textDoc) ? (
              <div className="part-head">
                {pi.part.label && <span className="label">{partLabel(pi.part.label)}</span>}
                <AmbossText cacheKey={question.id} texts={ambossTexts} text={pi.part.text} doc={pi.part.textDoc} className="text marking-prompt" />
              </div>
            ) : null}
            <div className="two-col">
              <div>
                <h3>Your answer</h3>
                <CommentedAnswer key={`${attempt.id}:${pi.part.label}`} attemptId={attempt.id} partLabel={pi.part.label} doc={pi.answer?.doc} text={pi.answer?.text} comments={attempt.answerComments ?? []} />
                {previous && (
                  <details style={{ marginTop: "0.5rem" }}>
                    <summary className="muted" style={{ cursor: "pointer" }}>
                      Previous attempt{previousMark ? ` (${previousMark.parts.find((p) => p.label === pi.part.label)?.score ?? "?"}/${previousMark.parts.find((p) => p.label === pi.part.label)?.maxScore ?? "?"})` : ""}
                    </summary>
                    {prevAns?.doc ? <AnswerHtml doc={prevAns.doc} /> : <p className="pre">{prevAns?.text || "No answer written."}</p>}
                  </details>
                )}
              </div>
              <div>
                <h3>Marking guide</h3>
                {hasModelAnswer(pi.part) ? <ModelAnswerContent answer={pi.part} /> : <p className="muted">{wholeModel ? "Refer to the model answer above and enter your score below." : "No model answer for this part. Enter your score below."}</p>}
                <div className="row" style={{ marginTop: "0.6rem" }}>
                  <label style={{ margin: 0 }}>Score</label>
                  {scoreField(`score:${pi.part.label}`, pm.score, (n) => setPart(pi.part.label, { score: n }), pm.maxScore || undefined, `Score${pi.part.label ? ` for part ${pi.part.label}` : ""}`)}
                  <span>/</span>
                  {scoreField(`max:${pi.part.label}`, pm.maxScore, (n) => setPart(pi.part.label, { maxScore: n }), undefined, `Maximum score${pi.part.label ? ` for part ${pi.part.label}` : ""}`)}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <section className="card marking-notes" aria-label="Your marking">
        <div className="row spread">
          <strong>Total {total} / {max}</strong>
          <button className={"review-later-button" + (reviewLater || lookedAtAnswer ? " selected" : "")} aria-pressed={reviewLater || lookedAtAnswer} disabled={lookedAtAnswer} title={lookedAtAnswer ? "Answer-assisted attempts are flagged for another review" : undefined} onClick={() => { setReviewLater(!reviewLater); }}>{reviewLater || lookedAtAnswer ? "⚑ Review later" : "⚐ Review later"}</button>
        </div>
        <label className="check assisted-answer"><input type="checkbox" checked={lookedAtAnswer} onChange={(e) => { onChange({ ...draft, lookedAtAnswer: e.target.checked, reviewLater: e.target.checked || reviewLater }); }} /> Looked at the answer</label>
        <label htmlFor={`mark-notes-${attempt.id}`}>My notes</label>
        <AutoTextarea id={`mark-notes-${attempt.id}`} placeholder="What do you want to remember?" value={notes} onChange={(e) => { setNotes(e.target.value); }} style={{ minHeight: "5rem" }} />
        <details className="marking-extra">
          <summary>More options</summary>
          <div className="stack">
            <label>Confidence <select value={confidence ?? ""} onChange={(e) => setConfidence(e.target.value ? Number(e.target.value) : undefined)}><option value="">Not rated</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}{n === 1 ? " — guessing" : n === 5 ? " — certain" : ""}</option>)}</select></label>
            <div><label>What went wrong</label><div className="row">{ERROR_TAGS.map((t) => <button type="button" key={t.id} className={"chip" + (errorTags.includes(t.id) ? " on" : "")} aria-pressed={errorTags.includes(t.id)} onClick={() => setErrorTags(errorTags.includes(t.id) ? errorTags.filter((x) => x !== t.id) : [...errorTags, t.id])}>{t.label}</button>)}</div></div>
            <label>Learning point for Anki<input type="text" value={learningPoint} onChange={(e) => setLearningPoint(e.target.value)} /></label>
          </div>
        </details>
      </section>
    </section>
  );
}
