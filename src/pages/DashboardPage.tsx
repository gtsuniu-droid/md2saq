import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router";
import { db } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import { formatDate } from "../lib/questions";
import { shuffle, startSession } from "../lib/session";
import { DEFAULT_SETTINGS } from "../data/types";
import { totalMarks } from "../lib/questions";

interface Row {
  id: string;
  questions: number;
  attempts: number;
  marks: number;
  lastStudied?: number;
  meanPct?: number;
}

export default function DashboardPage() {
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const [questions, attempts, marks, settings] = await Promise.all([
      db.questions.toArray(),
      db.attempts.filter((a) => a.submittedAt !== undefined).toArray(),
      db.marks.toArray(),
      db.settings.get("settings"),
    ]);
    const byQuestion = new Map(questions.map((q) => [q.id, q]));
    const rows = new Map<string, Row>(PRESENTATIONS.map((p) => [p.id, { id: p.id, questions: 0, attempts: 0, marks: 0 }]));
    for (const q of questions) for (const pid of q.presentations) rows.get(pid)!.questions++;
    for (const a of attempts) {
      const q = byQuestion.get(a.questionId);
      if (!q) continue;
      for (const pid of q.presentations) {
        const r = rows.get(pid)!;
        r.attempts++;
        r.lastStudied = Math.max(r.lastStudied ?? 0, a.submittedAt ?? 0);
      }
    }
    const pctSums = new Map<string, { sum: number; n: number }>();
    for (const m of marks) {
      const q = byQuestion.get(m.questionId);
      if (!q) continue;
      for (const pid of q.presentations) {
        rows.get(pid)!.marks++;
        if (m.maxScore > 0) {
          const s = pctSums.get(pid) ?? { sum: 0, n: 0 };
          s.sum += m.score / m.maxScore;
          s.n++;
          pctSums.set(pid, s);
        }
      }
    }
    for (const [pid, s] of pctSums) rows.get(pid)!.meanPct = Math.round((100 * s.sum) / s.n);
    return { rows, questions, settings: settings ?? DEFAULT_SETTINGS };
  }, []);

  if (!data) return null;
  const { rows, questions, settings } = data;
  const studied = [...rows.values()].filter((r) => r.marks > 0).length;
  const attemptedOnly = [...rows.values()].filter((r) => r.marks === 0 && r.attempts > 0).length;

  const startWeakest = () => {
    // Least-covered presentation that actually has unattempted questions.
    const candidates = PRESENTATIONS
      .map((p) => rows.get(p.id)!)
      .filter((r) => r.questions > 0)
      .sort((a, b) => a.marks - b.marks || a.attempts - b.attempts || (a.lastStudied ?? 0) - (b.lastStudied ?? 0));
    const target = candidates[0];
    if (!target) return;
    const pool = shuffle(questions.filter((q) => q.presentations.includes(target.id))).slice(0, 3);
    const totalSec = pool.reduce((acc, q) => acc + (totalMarks(q) ?? 4) * settings.minutesPerMark * 60, 0);
    startSession(pool.map((q) => q.id), "practice", Math.round(totalSec));
    nav("/paper");
  };

  return (
    <div>
      <div className="row spread">
        <div>
          <div className="coverage">{studied} of {PRESENTATIONS.length} studied</div>
          <div className="muted">
            {attemptedOnly > 0 ? `${attemptedOnly} attempted but unmarked, ` : ""}{questions.length} question{questions.length === 1 ? "" : "s"} in your library
          </div>
        </div>
        <button onClick={startWeakest} disabled={questions.length === 0}>Practise weakest</button>
      </div>
      {questions.length === 0 && (
        <p className="muted" style={{ marginTop: "1rem" }}>
          No questions yet. Paste some on the Create page, or pull a set from the Bank.
        </p>
      )}
      <div className="dash-list">
        {PRESENTATIONS.map((p) => {
          const r = rows.get(p.id)!;
          const state = r.marks > 0 ? "studied" : r.attempts > 0 ? "attempted" : "";
          const stat = [
            r.questions > 0 ? `${r.questions} q` : "",
            r.marks > 0 ? `${r.marks} marked` : r.attempts > 0 ? `${r.attempts} attempted` : "",
            r.meanPct !== undefined ? `${r.meanPct}%` : "",
            r.lastStudied ? formatDate(r.lastStudied) : "",
          ].filter(Boolean).join(", ");
          return (
            <div key={p.id} className={"dash-row" + (p.parent ? " child" : "")} onClick={() => nav(`/browse?presentation=${p.id}`)}>
              <span className={"status " + state} />
              <span className="name">{p.name}</span>
              <span className="stat">{stat}</span>
              <button className="small add" title={`Add a question set for ${p.name}`}
                onClick={(e) => { e.stopPropagation(); nav(`/create?presentation=${p.id}`); }}>+</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
