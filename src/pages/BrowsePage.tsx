import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PRESENTATIONS, presentationName } from "../data/presentations";
import { formatDate } from "../lib/questions";
import { loadSummaries } from "../lib/sets";

export default function BrowsePage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const presentation = params.get("presentation") ?? "";
  const status = params.get("status") ?? "";
  const tag = params.get("tag") ?? "";
  const collection = params.get("collection") ?? "";
  const [search, setSearch] = useState("");

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };

  const summaries = useLiveQuery(loadSummaries, []);

  const filtered = useMemo(() => {
    if (!summaries) return [];
    const q = search.trim().toLowerCase();
    return summaries.filter((s) => {
      if (presentation && !s.presentations.includes(presentation)) return false;
      if (tag && !(s.set.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
      if (collection && (s.set.collection ?? "") !== collection) return false;
      const sat = s.sittings.length > 0;
      const marked = s.sittings.some((x) => x.marked > 0);
      if (status === "new" && sat) return false;
      if (status === "sat" && !sat) return false;
      if (status === "unmarked" && (!sat || marked)) return false;
      if (q) {
        const hay = [s.set.name, s.set.source ?? "", s.set.collection ?? "", ...(s.set.tags ?? []), ...s.questions.map((x) => x.text), ...s.questions.flatMap((x) => x.stems ?? [])].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [summaries, presentation, status, search, tag, collection]);

  if (!summaries) return null;
  const allTags = [...new Set(summaries.flatMap((s) => s.set.tags ?? []))].sort((a, b) => a.localeCompare(b));
  const collections = [...new Set(summaries.map((s) => s.set.collection).filter((c): c is string => !!c))].sort();

  return (
    <div>
      <h1>Browse</h1>
      <div className="row">
        <select value={presentation} onChange={(e) => setParam("presentation", e.target.value)}>
          <option value="">All presentations</option>
          {PRESENTATIONS.map((p) => (
            <option key={p.id} value={p.id}>{p.parent ? "  ↳ " : ""}{p.name}</option>
          ))}
        </select>
        {allTags.length > 0 && (
          <select value={tag} onChange={(e) => setParam("tag", e.target.value)}>
            <option value="">All conditions</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {collections.length > 0 && (
          <select value={collection} onChange={(e) => setParam("collection", e.target.value)}>
            <option value="">All collections</option>
            {collections.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select value={status} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">Any status</option>
          <option value="new">Not sat yet</option>
          <option value="sat">Sat</option>
          <option value="unmarked">Sat, unmarked</option>
        </select>
        <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="small link" onClick={() => nav(presentation ? `/create?presentation=${presentation}` : "/create")}>
          + New set{presentation ? ` for ${presentationName(presentation)}` : ""}
        </button>
      </div>

      <table style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Set</th>
            <th>Questions</th>
            <th>Marks</th>
            <th>Sat</th>
            <th>Last score</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => {
            const last = s.sittings[0];
            return (
              <tr key={s.set.id} className="clickable" onClick={() => nav(`/set/${s.set.id}`)}>
                <td>
                  {s.set.name}
                  <div className="muted">
                    {[(s.set.tags ?? []).slice(0, 4).join(", ") || s.presentations.slice(0, 3).map(presentationName).join(", "), s.set.suggestedMinutes ? `${s.set.suggestedMinutes} min` : "", s.set.bankId ? "in the bank" : ""]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                </td>
                <td>{s.questions.length}</td>
                <td>{s.marks || "—"}</td>
                <td>{s.sittings.length || "—"}</td>
                <td>{last ? (last.maxScore > 0 ? `${last.score}/${last.maxScore}, ${formatDate(last.submittedAt)}` : `unmarked, ${formatDate(last.submittedAt)}`) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filtered.length === 0 && (
        <p className="muted" style={{ marginTop: "1rem" }}>
          {summaries.length === 0 ? "No sets yet. Paste a paper on the Create page, or pull one from the Bank." : "Nothing matches."}
        </p>
      )}
    </div>
  );
}
