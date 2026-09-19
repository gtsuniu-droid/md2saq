import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { db } from "../data/db";
import { PRESENTATIONS, presentationName } from "../data/presentations";
import { DEFAULT_SETTINGS } from "../data/types";
import { formatDate, totalMarks, truncate } from "../lib/questions";
import { shuffle, startSession } from "../lib/session";
import ShareSetButton from "../components/ShareSetButton";

export default function LibraryPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const presentation = params.get("presentation") ?? "";
  const setId = params.get("set") ?? "";
  const status = params.get("status") ?? "";
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"practice" | "exam">("practice");
  const [minutes, setMinutes] = useState<string>("");

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };

  const data = useLiveQuery(async () => {
    const [questions, sets, attempts, marks, settings] = await Promise.all([
      db.questions.orderBy("createdAt").reverse().toArray(),
      db.sets.toArray(),
      db.attempts.filter((a) => a.submittedAt !== undefined).toArray(),
      db.marks.toArray(),
      db.settings.get("settings"),
    ]);
    const attemptsByQ = new Map<string, number>();
    for (const a of attempts) attemptsByQ.set(a.questionId, (attemptsByQ.get(a.questionId) ?? 0) + 1);
    const lastMark = new Map<string, { score: number; max: number; at: number }>();
    for (const m of marks) {
      const cur = lastMark.get(m.questionId);
      if (!cur || m.markedAt > cur.at) lastMark.set(m.questionId, { score: m.score, max: m.maxScore, at: m.markedAt });
    }
    return { questions, sets: new Map(sets.map((s) => [s.id, s])), attemptsByQ, lastMark, settings: settings ?? DEFAULT_SETTINGS };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.questions.filter((x) => {
      if (presentation && !x.presentations.includes(presentation)) return false;
      if (setId && x.setId !== setId) return false;
      const attempted = (data.attemptsByQ.get(x.id) ?? 0) > 0;
      const marked = data.lastMark.has(x.id);
      if (status === "new" && attempted) return false;
      if (status === "attempted" && !attempted) return false;
      if (status === "unmarked" && (!attempted || marked)) return false;
      if (status === "marked" && !marked) return false;
      if (q && !(x.text + " " + x.parts.map((p) => p.text).join(" ")).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, presentation, setId, status, search]);

  if (!data) return null;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectAll = () => setSelected(new Set(filtered.map((q) => q.id)));
  const selectRandom = (n: number) => setSelected(new Set(shuffle(filtered).slice(0, n).map((q) => q.id)));

  const selectedQuestions = filtered.filter((q) => selected.has(q.id));
  const suggestedMinutes = Math.round(
    selectedQuestions.reduce((acc, q) => acc + (totalMarks(q) ?? 4) * data.settings.minutesPerMark, 0),
  );
  const start = () => {
    const ids = data.questions.filter((q) => selected.has(q.id)).map((q) => q.id);
    if (ids.length === 0) return;
    const mins = minutes.trim() === "" ? suggestedMinutes : Number(minutes);
    startSession(ids, mode, mins > 0 ? Math.round(mins * 60) : undefined);
    nav("/paper");
  };

  const deleteSet = async () => {
    if (!setId) return;
    const set = data.sets.get(setId);
    if (!confirm(`Delete set "${set?.name}" and all its questions, attempts and marks?`)) return;
    const qids = data.questions.filter((q) => q.setId === setId).map((q) => q.id);
    await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
      await db.marks.where("questionId").anyOf(qids).delete();
      await db.attempts.where("questionId").anyOf(qids).delete();
      await db.questions.bulkDelete(qids);
      await db.sets.delete(setId);
    });
    setParam("set", "");
  };

  return (
    <div>
      <h1>Library</h1>
      <div className="row">
        <select value={presentation} onChange={(e) => setParam("presentation", e.target.value)}>
          <option value="">All presentations</option>
          {PRESENTATIONS.map((p) => <option key={p.id} value={p.id}>{p.parent ? "  ↳ " : ""}{p.name}</option>)}
        </select>
        <select value={setId} onChange={(e) => setParam("set", e.target.value)}>
          <option value="">All sets</option>
          {[...data.sets.values()].sort((a, b) => b.createdAt - a.createdAt).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">Any status</option>
          <option value="new">Not attempted</option>
          <option value="attempted">Attempted</option>
          <option value="unmarked">Attempted, unmarked</option>
          <option value="marked">Marked</option>
        </select>
        <input type="search" placeholder="Search text" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="small" onClick={() => nav(presentation ? `/import?presentation=${presentation}` : "/import")}>
          + Add set{presentation ? ` for ${presentationName(presentation)}` : ""}
        </button>
        {setId && <ShareSetButton setId={setId} className="small" />}
        {setId && <button className="small danger" onClick={deleteSet}>Delete set</button>}
      </div>

      <div className="row" style={{ margin: "0.8rem 0" }}>
        <span className="muted">{filtered.length} shown · {selected.size} selected</span>
        <button className="small" onClick={selectAll}>Select all shown</button>
        <button className="small" onClick={() => selectRandom(3)}>Random 3</button>
        <button className="small" onClick={() => selectRandom(5)}>Random 5</button>
        <button className="small" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear</button>
      </div>

      {selected.size > 0 && (
        <div className="card row" style={{ marginBottom: "0.8rem" }}>
          <label style={{ margin: 0 }}>Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as "practice" | "exam")}>
            <option value="practice">Practice (mark each question as you go)</option>
            <option value="exam">Exam (nothing revealed until the paper is submitted)</option>
          </select>
          <label style={{ margin: 0 }}>Minutes</label>
          <input type="number" min={0} placeholder={String(suggestedMinutes)} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <span className="muted">blank = {suggestedMinutes} min from marks, 0 = no timer</span>
          <button className="primary" onClick={start}>Start {selected.size} question{selected.size === 1 ? "" : "s"}</button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th></th>
            <th>Question</th>
            <th>Presentations</th>
            <th>Marks</th>
            <th>Done</th>
            <th>Last score</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((q) => {
            const lm = data.lastMark.get(q.id);
            return (
              <tr key={q.id} className="clickable" onClick={() => nav(`/question/${q.id}`)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggle(q.id)} />
                </td>
                <td>
                  {truncate(q.text || q.parts[0]?.text || "")}
                  <div className="muted">{data.sets.get(q.setId)?.name} · Q{q.order + 1}{q.parts.length ? ` · ${q.parts.length} parts` : ""}{q.modelAnswer || q.parts.some((p) => p.modelAnswer) ? " · has model answer" : ""}</div>
                </td>
                <td>{q.presentations.map((p) => <span key={p} className="chip static">{presentationName(p)}</span>)}</td>
                <td>{totalMarks(q) ?? "—"}</td>
                <td>{data.attemptsByQ.get(q.id) ?? 0}</td>
                <td>{lm ? `${lm.score}/${lm.max} · ${formatDate(lm.at)}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filtered.length === 0 && <p className="muted">Nothing matches.</p>}
    </div>
  );
}
