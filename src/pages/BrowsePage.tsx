import LibraryStatus from "../components/LibraryStatus";
import { useSetContent } from "../lib/useSetContent";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { getSettings } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import { loadSummaries, suggestedMinutesFor, type SetSummary } from "../lib/sets";
import { loadSession, startSession } from "../lib/session";
import { isAdmin } from "../lib/admin";
import { browseSets, browseSetTitle } from "../lib/browseSets";
import { introducedStems } from "../lib/markingSet";
import { hasModelAnswer, richAnswerDocument } from "../lib/modelAnswer";
import { partLabel, totalMarks, truncate } from "../lib/questions";
import AmbossText from "../components/AmbossText";
import ModelAnswerContent from "../components/ModelAnswerContent";
import SetEditPage from "./SetEditPage";
import { applyPersonalSetEdits, loadPersonalSetEdits, resetPersonalSetEdits } from "../lib/personalSetEdits";
import { bankErrorMessage, deleteSetEverywhere } from "../lib/share";

export default function BrowsePage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const detail = useRef<HTMLDivElement>(null);
  const data = useLiveQuery(async () => {
    const settings = await getSettings();
    const personal = isAdmin(settings) ? new Map() : await loadPersonalSetEdits(settings.cloudUser?.uid ?? "");
    const summaries = (await loadSummaries()).map((summary) => ({ ...summary, questions: applyPersonalSetEdits(summary.questions, personal.get(summary.set.id)) }));
    return { summaries, settings, personal };
  }, []);
  const search = params.get("q") ?? "";
  const presentation = params.get("presentation") ?? "";
  const tag = params.get("tag");
  const collection = params.get("collection");
  const sets = useMemo(() => browseSets(data?.summaries ?? [], search, presentation, tag, collection), [data, search, presentation, tag, collection]);
  const selected = sets.find((s) => s.set.id === params.get("set")) ?? sets[0];
  // Keep the editor mounted if live updates change the matching list mid-edit.
  const active = editing ? data?.summaries.find((s) => s.set.id === editing) : selected;

  const content = useSetContent(active?.set.id, active?.set.bankUpdatedAt);

  useEffect(() => { detail.current?.scrollTo(0, 0); setMessage(""); }, [active?.set.id]);

  function changeFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete("set");
    setParams(next, { replace: true });
  }
  function select(id: string) {
    if (editing || deleting) return;
    setDeleteError("");
    const next = new URLSearchParams(params);
    next.set("set", id);
    setParams(next, { replace: true });
  }
  function start(summary: SetSummary) {
    if (!data) return;
    if (loadSession() && !confirm("Replace your unfinished session? Submitted answers will be kept.")) return;
    startSession(summary.questions.map((q) => q.id), "practice", Math.round(suggestedMinutesFor(summary, data.settings.minutesPerMark) * 60), "sets");
    nav("/paper");
  }

  async function remove(summary: SetSummary) {
    if (!data || !isAdmin(data.settings) || deleting) return;
    setDeleteError("");
    if (summary.set.bankId && !data.settings.bankPasscode) {
      setDeleteError("Unlock Admin in Settings to delete a shared set.");
      return;
    }
    if (!confirm(`Delete “${browseSetTitle(summary)}”${summary.set.bankId ? " for everyone" : ""}? This removes all ${summary.questions.length} questions in the set and their attempts on this device.`)) return;
    const index = sets.findIndex(s => s.set.id === summary.set.id);
    const nextSet = sets[index + 1] ?? sets[index - 1];
    setDeleting(true);
    try {
      await deleteSetEverywhere(summary.set.id);
      const next = new URLSearchParams(params);
      if (nextSet) next.set("set", nextSet.set.id);
      else next.delete("set");
      setParams(next, { replace: true });
    } catch (error) {
      setDeleteError(`Could not delete: ${bankErrorMessage(error)}`);
    } finally {
      setDeleting(false);
    }
  }

  return <div className={`browse-workspace${params.has("set") || editing ? " browse-detail-open" : ""}`}>
    <header className="browse-heading"><h1>Browse</h1>{data && isAdmin(data.settings) && !editing && <Link className="button small" to="/create">New set</Link>}</header>
    <LibraryStatus /><div className="browse-panes">
      <aside className="browse-library" aria-label="Set library">
        <fieldset className="browse-filters" disabled={!!editing || deleting}>
          <input type="search" aria-label="Search sets and questions" placeholder="Search sets and questions" value={search} onChange={(e) => changeFilter("q", e.target.value)} />
          <select aria-label="Presentation" value={presentation} onChange={(e) => changeFilter("presentation", e.target.value)}>
            <option value="">All presentations</option>
            {PRESENTATIONS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="unassigned">Unassigned</option>
          </select>
          {(tag || collection) && <button className="small link" onClick={() => { const next = new URLSearchParams(params); next.delete("tag"); next.delete("collection"); setParams(next, { replace: true }); }}>Clear {tag ? "tag" : "collection"} filter</button>}
        </fieldset>
        <div className="browse-count" role="status">{data ? `${sets.length} ${sets.length === 1 ? "set" : "sets"}` : "Loading…"}</div>
        <div className="browse-set-list" role="list" aria-label="Sets">
          {sets.map((summary, index) => <div role="listitem" key={summary.set.id}>
            <button className={`browse-set-row${active?.set.id === summary.set.id ? " selected" : ""}`} disabled={!!editing || deleting} aria-current={active?.set.id === summary.set.id ? "true" : undefined}
              onClick={() => select(summary.set.id)} onKeyDown={(event) => {
                const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
                if (!delta) return;
                event.preventDefault();
                const next = sets[index + delta];
                if (next) { select(next.set.id); const rows = event.currentTarget.closest('[role="list"]')?.querySelectorAll<HTMLButtonElement>(".browse-set-row"); rows?.[index + delta]?.focus(); }
              }}>
              <span className="browse-set-title">{browseSetTitle(summary)}</span>
              <span className="browse-set-preview">{truncate(summary.questions[0]?.stems?.[0] || summary.questions[0]?.text || summary.set.source || "Empty set", 110)}</span>
              <span className="browse-set-count">{summary.questions.length}</span>
            </button>
          </div>)}
          {data && !sets.length && <p className="browse-empty">{data.summaries.length ? "No matching sets." : "No sets yet."}</p>}
        </div>
      </aside>
      <section className="browse-detail" aria-label="Selected set">
        {deleteError && <p className="browse-save-message field-error" role="alert">{deleteError} {data && !data.settings.bankPasscode && <Link to="/settings#admin">Settings</Link>}</p>}
        {active ? <>
          <header className="browse-detail-heading">
            <div><button className="small link browse-back" disabled={!!editing} onClick={() => { const next = new URLSearchParams(params); next.delete("set"); setParams(next, { replace: true }); }}>← Sets</button><h2>{browseSetTitle(active)}</h2><span className="muted">{active.questions.length} questions</span></div>
            {!editing && <div className="row"><button className="small" disabled={deleting || (!content.ready || active.contentReady === false) || !active.questions.length} onClick={() => start(active)}>Practice</button><button className="small" disabled={deleting || !content.ready || active.contentReady === false} onClick={() => { select(active.set.id); setEditing(active.set.id); detail.current?.scrollTo(0, 0); }}>Edit</button>{data && isAdmin(data.settings) && <button className="small danger" aria-label="Delete set" title="Delete set" disabled={deleting || !content.ready || active.contentReady === false} onClick={() => void remove(active)}>{deleting ? "Deleting…" : "×"}</button>}</div>}
          </header>
          <div className="browse-detail-scroll" ref={detail}>
            {message && <p className={`browse-save-message${/not published|Could not/.test(message) ? " field-error" : ""}`} role={/not published|Could not/.test(message) ? "alert" : "status"}>{message}</p>}
            {!editing && data?.personal?.has(active.set.id) && <div className="browse-personal-notice"><span>Personal edits</span><button className="small link" onClick={async () => {
              if (!confirm("Reset your personal edits to the shared version?")) return;
              try { await resetPersonalSetEdits(data.settings.cloudUser?.uid ?? "", active.set.id); setMessage("Shared version restored."); }
              catch { setMessage("Could not reset your edits. Try again."); }
            }}>Reset</button></div>}
            {!content.ready || active.contentReady === false ? <div role="status"><p>{content.error || "Loading set…"}</p>{content.error && <button onClick={content.retry}>Retry</button>}</div> : editing ? <SetEditPage key={editing} embeddedSetId={editing} onDone={(note) => { setEditing(null); setMessage(note ?? ""); detail.current?.scrollTo(0, 0); }} /> : <BrowseContent key={active.set.id} summary={active} />}
          </div>
        </> : <div className="browse-empty">{data ? "Choose a set to view its questions." : "Loading…"}</div>}
      </section>
    </div>
  </div>;
}

function BrowseContent({ summary }: { summary: SetSummary }) {
  const seenImages = new Set<string>();
  return <div className="browse-reading">
    {summary.set.instructions && <details className="browse-instructions"><summary>Instructions</summary><p className="pre">{summary.set.instructions}</p></details>}
    {summary.questions.map((q, index) => {
      const stems = introducedStems(q, summary.questions[index - 1]);
      const texts = [...(q.stems ?? []), q.text, ...q.parts.map((p) => p.text)];
      const stemImages = (q.images ?? []).filter((im) => {
        if (im.place !== "stem" || seenImages.has(im.dataUrl)) return false;
        seenImages.add(im.dataUrl); return true;
      });
      const marks = totalMarks(q);
      return <article className="browse-question" key={q.id}>
        {stems.map((stem) => <div className="browse-stem" key={stem.index}><AmbossText cacheKey={`browse:${q.id}`} texts={texts} text={stem.text} doc={q.stemDocs?.[stem.index]} /></div>)}
        {stemImages.map((im) => <figure key={im.id}><img src={im.dataUrl} alt={im.caption || "Case image"} />{im.caption && <figcaption>{im.caption}</figcaption>}</figure>)}
        <div className="browse-question-number"><h3>Question {index + 1}</h3>{marks !== undefined && <span>{marks} {marks === 1 ? "mark" : "marks"}</span>}</div>
        <AmbossText cacheKey={`browse:${q.id}`} texts={texts} text={q.text} doc={q.textDoc} className="pre browse-prompt" />
        {(q.images ?? []).filter((im) => im.place === "question").map((im) => <figure key={im.id}><img src={im.dataUrl} alt={im.caption || "Question image"} />{im.caption && <figcaption>{im.caption}</figcaption>}</figure>)}
        {q.parts.map((p, pi) => <div key={pi} className="browse-part"><strong>{partLabel(p.label)}</strong><AmbossText cacheKey={`browse:${q.id}`} texts={texts} text={p.text} doc={p.textDoc} className="pre browse-prompt" /></div>)}
        <BrowseAnswer question={q} />
      </article>;
    })}
    {!summary.questions.length && <p className="muted">No questions in this set.</p>}
  </div>;
}

function BrowseAnswer({ question: q }: { question: SetSummary["questions"][number] }) {
  const [open, setOpen] = useState(false);
  return <div className="browse-answer">
    <button className="small link" aria-expanded={open} aria-controls={`answer-${q.id}`} onClick={() => setOpen(!open)}>{open ? "Hide answer" : "Show answer"}</button>
    {open && <div id={`answer-${q.id}`} className="browse-answer-content">
      {q.parts.filter(hasModelAnswer).map((p, i) => <div key={i}><strong>{partLabel(p.label)}</strong><ModelAnswerContent answer={p} /></div>)}
      {hasModelAnswer(q) && (richAnswerDocument(q) || !q.parts.some(hasModelAnswer)) && <ModelAnswerContent answer={q} />}
      {!hasModelAnswer(q) && !q.parts.some(hasModelAnswer) && <p className="muted">No answer added yet.</p>}
    </div>}
  </div>;
}
