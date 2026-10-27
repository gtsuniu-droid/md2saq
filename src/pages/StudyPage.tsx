import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { db, getSettings } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import type { Question } from "../data/types";
import ModelAnswerContent from "../components/ModelAnswerContent";
import { fetchStudySession, formatCode, shareMyAnswers, studyRecord, subscribeSharedAnswers, type SharedAnswers, type StudySession } from "../lib/study";

function Face({ name, photo }: { name: string; photo?: string }) {
  return <span className="lb-avatar plain" aria-hidden="true">{photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : name.charAt(0).toUpperCase()}</span>;
}

/** Everyone's answers to a study session's questions, side by side, with self-marked scores. */
export default function StudyPage() {
  const { code = "" } = useParams();
  const settings = useLiveQuery(getSettings, []);
  const [study, setStudy] = useState<StudySession | null | undefined>(undefined);
  const [shared, setShared] = useState<SharedAnswers[]>([]);
  const [mine, setMine] = useState<"shared" | "none" | "pending">("pending");
  const [error, setError] = useState("");
  const [local, setLocal] = useState<(Question | undefined)[]>([]);
  const me = settings?.cloudUser?.uid;

  useEffect(() => {
    if (!me) return;
    let live = true; let stop: (() => void) | undefined;
    void (async () => {
      try {
        const s = await fetchStudySession(code);
        if (!live) return;
        setStudy(s);
        if (!s) return;
        const record = await studyRecord(code);
        if (record) setLocal(await db.questions.bulkGet(record.questionIds));
        const posted = await shareMyAnswers(code).catch(() => null);
        if (live) setMine(posted ? "shared" : "none");
        stop = await subscribeSharedAnswers(code, (rows) => { if (live) setShared(rows); }, (m) => { if (live) setError(m); });
      } catch (e) { if (live) { setError(e instanceof Error ? e.message : "Could not load this session."); setStudy(null); } }
    })();
    return () => { live = false; stop?.(); };
  }, [code, me]);

  const people = useMemo(() => {
    if (!study) return [];
    const byUid = new Map(study.participants.map((p) => [p.uid, { uid: p.uid, name: p.name, photo: p.photo }]));
    for (const s of shared) if (!byUid.has(s.uid)) byUid.set(s.uid, { uid: s.uid, name: s.name, photo: s.photo });
    const answers = new Map(shared.map((s) => [s.uid, s]));
    return [...byUid.values()].map((p) => {
      const a = answers.get(p.uid);
      const marked = (a?.answers ?? []).filter((x) => x.score !== undefined);
      return { ...p, answers: a, score: marked.reduce((t, x) => t + (x.score ?? 0), 0), max: marked.reduce((t, x) => t + (x.maxScore ?? 0), 0), marked: marked.length };
    }).sort((a, b) => (a.uid === me ? -1 : b.uid === me ? 1 : a.name.localeCompare(b.name)));
  }, [study, shared, me]);

  if (!settings) return null;
  if (!me) return <div className="study-compare"><h1>Compare answers</h1><p className="muted">Sign in to see a study session.</p></div>;
  if (study === undefined && !error) return <div className="study-compare"><p className="muted" role="status">Loading…</p></div>;
  if (!study) return <div className="study-compare"><h1>Compare answers</h1><p className="field-error">{error || "No session has that code."}</p><Link to="/home">Back to home</Link></div>;
  const names = study.presentations.map((id) => PRESENTATIONS.find((p) => p.id === id)?.name ?? id).join(", ");

  return (
    <div className="study-compare">
      <header className="row spread leaderboard-head">
        <div><h1>Compare answers</h1><p className="muted">Study session <strong className="study-inline-code">{formatCode(study.code)}</strong> · {study.questions.length} questions · {people.length} {people.length === 1 ? "person" : "people"}{names ? ` · ${names}` : ""}</p></div>
        {mine === "shared" ? <span className="lb-chip"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Your answers are shared</span>
          : mine === "none" ? <span className="muted">Sit the session from your home page with code {formatCode(study.code)} to share yours.</span> : null}
      </header>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="study-people-grid">
        {people.map((p) => <div key={p.uid} className="study-person"><Face name={p.name} photo={p.photo} /><div><strong>{p.name}{p.uid === me && <span className="lb-you">you</span>}</strong><span className="muted">{p.marked ? `${p.score} / ${p.max} marked` : p.answers ? "Not marked yet" : "Not shared yet"}</span></div></div>)}
      </div>
      {study.questions.map((q, i) => {
        const lq = local[i];
        return (
          <section key={i} className="card study-question" aria-label={`Question ${i + 1}`}>
            <div className="row spread study-question-head"><p><span className="study-qnum">{i + 1}</span>{q.text}</p>{q.marks !== undefined && <span className="muted">{q.marks} marks</span>}</div>
            <div className="study-answers" style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, people.length))}, minmax(0, 1fr))` }}>
              {people.map((p) => {
                const a = p.answers?.answers.find((x) => x.index === i);
                if (!a) return <div key={p.uid} className="study-answer empty"><span className="muted">{p.name} has not shared this one yet</span></div>;
                return <div key={p.uid} className="study-answer"><div className="row spread"><span className="study-answer-name">{p.name}</span>{a.score !== undefined ? <span className={`study-score${a.maxScore && a.score / a.maxScore >= 0.7 ? " good" : ""}`}>{a.score} / {a.maxScore}</span> : <span className="study-score none">not marked</span>}</div><p className="pre">{a.text || "(blank)"}</p></div>;
              })}
            </div>
            {lq && (lq.modelAnswer || lq.modelAnswerDoc || lq.parts.some((p) => p.modelAnswer || p.modelAnswerDoc)) && (
              <details className="study-model"><summary>Show the model answer</summary>
                {!!(lq.modelAnswer || lq.modelAnswerDoc) && <ModelAnswerContent answer={{ modelAnswer: lq.modelAnswer, modelAnswerDoc: lq.modelAnswerDoc }} />}
                {lq.parts.map((p) => (p.modelAnswer || p.modelAnswerDoc) ? <div key={p.label}><strong>({p.label})</strong><ModelAnswerContent answer={{ modelAnswer: p.modelAnswer, modelAnswerDoc: p.modelAnswerDoc }} /></div> : null)}
              </details>
            )}
          </section>
        );
      })}
      <p className="muted">Answers are shared when each person opens this page after finishing. Scores appear once they have marked themselves.</p>
    </div>
  );
}
