import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { getSettings } from "../data/db";
import { loadSummaries, setLabel, suggestedMinutesFor, type SetSummary } from "../lib/sets";
import { startSession } from "../lib/session";
import { buildTree, filterTree, searchHits, setsInBranch, type TreeNode } from "../lib/tree";
import { isAdmin } from "../lib/admin";

/** A tick once everything is marked; otherwise a slim bar, teal for marked and amber for answered but unmarked. Untouched shows nothing. */
function Progress({ total, attempted, marked }: { total: number; attempted: number; marked: number }) {
  if (total === 0 || attempted === 0) return <span className="bar empty" />;
  if (marked === total) return <span className="done-tick" title={`All ${total} marked`}>✓</span>;
  const m = (100 * marked) / total;
  const a = (100 * Math.max(0, attempted - marked)) / total;
  return (
    <span className="bar" title={`${marked} of ${total} marked${attempted > marked ? `, ${attempted - marked} answered but unmarked` : ""}`}>
      <span className="fill marked" style={{ width: `${m}%` }} />
      <span className="fill attempted" style={{ width: `${a}%` }} />
    </span>
  );
}

/** Text with every occurrence of the search term marked. */
function Highlight({ text, needle }: { text: string; needle: string }) {
  const n = needle.trim().toLowerCase();
  if (!n) return <>{text}</>;
  const out: ReactNode[] = [];
  let i = 0;
  const lower = text.toLowerCase();
  for (;;) {
    const at = lower.indexOf(n, i);
    if (at < 0) break;
    if (at > i) out.push(text.slice(i, at));
    out.push(<mark key={at} className="hit">{text.slice(at, at + n.length)}</mark>);
    i = at + n.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return <>{out}</>;
}

const EXPANDED_KEY = "saq-browse-expanded";

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Anki-style deck list: presentations and :: tags as branches, sets as leaves. */
export default function BrowsePage() {
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const data = useLiveQuery(async () => ({ summaries: await loadSummaries(), settings: await getSettings() }), []);

  const tree = useMemo(() => (data ? filterTree(buildTree(data.summaries), search) : []), [data, search]);
  const searching = search.trim().length > 0;

  if (!data) return null;

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });

  const practiseBranch = (node: TreeNode, mode: "practice" | "exam") => {
    const sets = setsInBranch(node);
    const ids = sets.flatMap((s) => s.questions.map((q) => q.id));
    if (ids.length === 0) return;
    const minutes = sets.reduce((acc, s) => acc + suggestedMinutesFor(s, data.settings.minutesPerMark), 0);
    startSession(ids, mode, Math.round(minutes * 60));
    nav("/paper");
  };

  const renderSet = (s: SetSummary, depth: number) => {
    const plainTags = (s.set.tags ?? []).filter((t) => !t.includes("::"));
    const hits = searching ? searchHits(s, search) : null;
    const detail = plainTags.length ? plainTags.join(", ") : s.set.source ?? "";
    return (
      <div key={s.set.id}>
        <div className="deck-row set" style={{ paddingLeft: `${0.7 + depth * 1.4}rem` }} onClick={() => nav(`/set/${s.set.id}`)}>
          <span className="caret" />
          <span className="name">
            <Highlight text={setLabel(s.set)} needle={search} />
            {detail && <span className="muted"> — <Highlight text={detail} needle={search} /></span>}
          </span>
          <Progress total={s.questions.length} attempted={s.attemptedQuestions} marked={s.markedQuestions} />
          <span className="actions" />
        </div>
        {hits && (hits.questions.length > 0 || hits.tags.some((t) => t.includes("::"))) && (
          <div className="deck-hits" style={{ paddingLeft: `${2.6 + depth * 1.4}rem` }}>
            {hits.tags.filter((t) => t.includes("::")).map((t) => (
              <div key={t} className="hit-line muted">tag <Highlight text={t} needle={search} /></div>
            ))}
            {hits.questions.map((h) => (
              <div key={h.questionId} className="hit-line" onClick={() => nav(`/question/${h.questionId}`)} title="Open this question">
                <span className="muted">Q{h.number}{h.field === "question" ? "" : `, ${h.field}`}:</span> <Highlight text={h.snippet} needle={search} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const open = searching || expanded.has(node.path);
    return (
      <div key={node.path}>
        <div className="deck-row branch" style={{ paddingLeft: `${0.7 + depth * 1.4}rem` }} onClick={() => toggle(node.path)}>
          <span className="caret">{open ? "▾" : "▸"}</span>
          <span className="name">{node.emoji && <span className="emoji">{node.emoji}</span>}{node.label}</span>
          <Progress total={node.questions} attempted={node.attempted} marked={node.marked} />
          <span className="actions" onClick={(e) => e.stopPropagation()}>
            <button className="small link" onClick={() => practiseBranch(node, "practice")} disabled={node.questions === 0}>Practice</button>
            <button className="small link" onClick={() => practiseBranch(node, "exam")} disabled={node.questions === 0}>Exam</button>
          </span>
        </div>
        {open && (
          <div>
            {node.children.map((c) => renderNode(c, depth + 1))}
            {node.sets.map((s) => renderSet(s, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Browse</h1>
        <span className="row">
          <input type="search" placeholder="Search tags and questions" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: "14rem" }} />
          <button className="small link" onClick={() => setExpanded(new Set(collectPaths(tree)))}>Expand all</button>
          <button className="small link" onClick={() => setExpanded(new Set())}>Collapse</button>
          {isAdmin(data.settings) && <button className="small link" onClick={() => nav("/settings#admin")}>+ New set</button>}
        </span>
      </div>
      <p className="muted" style={{ marginBottom: "0.8rem" }}>
        Sets sit under their presentation{isAdmin(data.settings) ? '. Tag a set "Presentation::Topic" in Admin to nest it, Anki style; several tags put it in several places.' : "."}
      </p>
      <div className="deck-list">
        {tree.map((n) => renderNode(n, 0))}
      </div>
      {tree.length === 0 && (
        <p className="muted" style={{ marginTop: "1rem" }}>
          {data.summaries.length === 0 ? "No sets yet. Add some in Admin, at the bottom of Settings." : "Nothing matches."}
        </p>
      )}
    </div>
  );
}

function collectPaths(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...collectPaths(n.children)]);
}
