import LibraryStatus from "../components/LibraryStatus";
import { useSetContent } from "../lib/useSetContent";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { db, getSettings } from "../data/db";
import { belongsToAccount } from "../lib/progressAccount";
import { browseQuestions, markedQuestions, type QuestionSort } from "../lib/browseQuestions";
import { scoreBand } from "../lib/scoreBand";
import { PRESENTATIONS } from "../data/presentations";
import { loadSummaries, suggestedMinutesFor, type SetSummary } from "../lib/sets";
import { loadSession, startSession } from "../lib/session";
import { isAdmin } from "../lib/admin";
import { browseSets, browseSetTitle, shortSatDate, type BrowseSort, type DoneFilter } from "../lib/browseSets";
import { introducedStems } from "../lib/markingSet";
import { hasModelAnswer, richAnswerDocument } from "../lib/modelAnswer";
import { partLabel, totalMarks, truncate } from "../lib/questions";
import AmbossText from "../components/AmbossText";
import ModelAnswerContent from "../components/ModelAnswerContent";
import SetEditPage from "./SetEditPage";
import { applyPersonalSetEdits, loadPersonalSetEdits, resetPersonalSetEdits } from "../lib/personalSetEdits";
import { bankErrorMessage, deleteSetEverywhere } from "../lib/share";
import { BankPasscodeError, verifyPasscode } from "../lib/bank";
import { patchSettings } from "../data/db";
import ConfirmDialog from "../components/ConfirmDialog";
import SetCode from "../components/SetCode";
import AccountGate from "../components/AccountGate";
import { useAccountGate } from "../lib/accountGate";
import { useLocation } from "react-router";

export default function BrowsePage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SetSummary | null>(null);
  const [passcode, setPasscode] = useState("");
  const [replacing, setReplacing] = useState<SetSummary | null>(null);
  const gate = useAccountGate();
  const [gateOpen, setGateOpen] = useState(false);
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const detail = useRef<HTMLDivElement>(null);
  const data = useLiveQuery(async () => {
    const settings = await getSettings();
    const personal = isAdmin(settings) ? new Map() : await loadPersonalSetEdits(settings.cloudUser?.uid ?? "");
    const summaries = (await loadSummaries()).map((summary) => ({ ...summary, questions: applyPersonalSetEdits(summary.questions, personal.get(summary.set.id)) }));
    const ownerId = settings.cloudUser?.uid ?? "";
    const [attempts, marks] = await Promise.all([db.attempts.toArray(), db.marks.toArray()]);
    return { summaries, settings, personal, marked: markedQuestions(summaries, attempts.filter((a) => belongsToAccount(a, ownerId)), marks.filter((m) => belongsToAccount(m, ownerId))) };
  }, []);
  const search = params.get("q") ?? "";
  const presentation = params.get("presentation") ?? "";
  const tag = params.get("tag");
  const collection = params.get("collection");
  const doneFilter = (["done", "new"].includes(params.get("done") ?? "") ? params.get("done") : "") as DoneFilter;
  const sort: BrowseSort = params.get("sort") === "sat" ? "sat" : "title";
  // Sets, or the questions the student had marked: worst first to find what went badly, or latest first.
  const questionsView = params.get("view") === "questions";
  const questionSort: QuestionSort = params.get("sort") === "latest" ? "latest" : "worst";
  const sets = useMemo(() => browseSets(data?.summaries ?? [], search, presentation, tag, collection, doneFilter, sort), [data, search, presentation, tag, collection, doneFilter, sort]);
  const marked = useMemo(() => browseQuestions(data?.marked ?? [], search, presentation, questionSort), [data, search, presentation, questionSort]);
  const doneCount = sets.filter((s) => s.done).length;
  const selected = sets.find((s) => s.set.id === params.get("set")) ?? sets[0];
  // Keep the editor mounted if live updates change the matching list mid-edit.
  const active = editing ? data?.summaries.find((s) => s.set.id === editing) : selected;

  const content = useSetContent(active?.set.id, active?.set.bankUpdatedAt);

  useEffect(() => { detail.current?.scrollTo(0, 0); setMessage((m) => (m.startsWith("Deleted ") ? m : "")); }, [active?.set.id]);
  useEffect(() => { if (flash) { setMessage(flash); window.history.replaceState({}, ""); } }, [flash]);

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
  function begin(summary: SetSummary) {
    if (!data) return;
    startSession(summary.questions.map((q) => q.id), "practice", Math.round(suggestedMinutesFor(summary, data.settings.minutesPerMark) * 60), "sets");
    nav("/paper");
  }
  function start(summary: SetSummary) {
    if (gate.gated) { setGateOpen(true); return; }
    if (loadSession()) { setReplacing(summary); return; }
    begin(summary);
  }

  const needsPasscode = !!pendingDelete?.set.bankId && !data?.settings.bankPasscode;

  async function remove(summary: SetSummary) {
    if (!data || !isAdmin(data.settings) || deleting) return;
    setDeleteError("");
    const index = sets.findIndex(s => s.set.id === summary.set.id);
    const nextSet = sets[index + 1] ?? sets[index - 1];
    setDeleting(true);
    try {
      if (summary.set.bankId && !data.settings.bankPasscode) {
        const code = passcode.trim();
        try { await verifyPasscode(code); }
        catch (error) {
          if (error instanceof BankPasscodeError) throw new Error("That passcode was not accepted.");
          if (!/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) throw error;
        }
        await patchSettings({ bankPasscode: code });
      }
      await deleteSetEverywhere(summary.set.id);
      setPendingDelete(null);
      setPasscode("");
      setMessage(`Deleted ${browseSetTitle(summary)}.`);
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
          <div className="seg" role="group" aria-label="View">
            <button type="button" className={!questionsView ? "on" : ""} aria-pressed={!questionsView} onClick={() => { const next = new URLSearchParams(params); next.delete("view"); next.delete("sort"); setParams(next, { replace: true }); }}>Sets</button>
            <button type="button" className={questionsView ? "on" : ""} aria-pressed={questionsView} onClick={() => { const next = new URLSearchParams(params); next.set("view", "questions"); next.delete("sort"); next.delete("done"); setParams(next, { replace: true }); }}>Questions</button>
          </div>
          <input type="search" aria-label="Search sets and questions" placeholder="Search sets and questions" value={search} onChange={(e) => changeFilter("q", e.target.value)} />
          <select aria-label="Presentation" value={presentation} onChange={(e) => changeFilter("presentation", e.target.value)}>
            <option value="">All presentations</option>
            {PRESENTATIONS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="unassigned">Unassigned</option>
          </select>
          {questionsView ? <div className="row browse-chips">
            <div className="seg" role="group" aria-label="Sort">
              {([["worst", "Lowest score"], ["latest", "Latest"]] as [QuestionSort, string][]).map(([value, label]) => <button key={value} type="button" className={questionSort === value ? "on" : ""} aria-pressed={questionSort === value} onClick={() => changeFilter("sort", value === "worst" ? "" : value)}>{label}</button>)}
            </div>
          </div> : <div className="row browse-chips">
            <div className="seg" role="group" aria-label="Done">
              {([["", "All"], ["new", "Not done"], ["done", "Done"]] as [DoneFilter, string][]).map(([value, label]) => <button key={value} type="button" className={doneFilter === value ? "on" : ""} aria-pressed={doneFilter === value} onClick={() => changeFilter("done", value)}>{label}</button>)}
            </div>
            <div className="seg" role="group" aria-label="Sort">
              {([["title", "Title"], ["sat", "Last sat"]] as [BrowseSort, string][]).map(([value, label]) => <button key={value} type="button" className={sort === value ? "on" : ""} aria-pressed={sort === value} onClick={() => changeFilter("sort", value === "title" ? "" : value)}>{label}</button>)}
            </div>
          </div>}
          {(tag || collection) && <button className="small link" onClick={() => { const next = new URLSearchParams(params); next.delete("tag"); next.delete("collection"); setParams(next, { replace: true }); }}>Clear {tag ? "tag" : "collection"} filter</button>}
        </fieldset>
        <div className="browse-count" role="status">{!data ? "Loading…" : questionsView ? `${marked.length} marked ${marked.length === 1 ? "question" : "questions"}` : `${doneCount}/${sets.length} done`}</div>
        {questionsView ? <div className="browse-set-list" role="list" aria-label="Marked questions">
          {marked.map((row) => <div role="listitem" key={row.attemptId}>
            <Link className="browse-set-row browse-question-row" to={`/history/${row.attemptId}`} title="Open this sitting">
              <span className="browse-set-title">{browseSetTitle(row.summary)}, Q{row.number}</span>
              <span className="browse-set-preview">{truncate(row.question.text || row.question.parts[0]?.text || "", 110)}</span>
              <span className={`browse-set-count history-pct ${scoreBand(row.percent)}`}>{row.percent}%</span>
              <span className="browse-set-sat"><time dateTime={new Date(row.at).toISOString()}>{shortSatDate(row.at)}</time><span className="browse-set-score">{row.score}/{row.maxScore}</span></span>
            </Link>
          </div>)}
          {data && !marked.length && <p className="browse-empty">{data.marked.length ? "No matching questions." : "Mark a sitting and its questions appear here."}</p>}
        </div> : <div className="browse-set-list" role="list" aria-label="Sets">
          {sets.map((summary, index) => <div role="listitem" key={summary.set.id}>
            <button className={`browse-set-row${active?.set.id === summary.set.id ? " selected" : ""}`} disabled={!!editing || deleting} aria-current={active?.set.id === summary.set.id ? "true" : undefined}
              onClick={() => select(summary.set.id)} onKeyDown={(event) => {
                const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
                if (!delta) return;
                event.preventDefault();
                const next = sets[index + delta];
                if (next) { select(next.set.id); const rows = event.currentTarget.closest('[role="list"]')?.querySelectorAll<HTMLButtonElement>(".browse-set-row"); rows?.[index + delta]?.focus(); }
              }}>
              <span className="browse-set-title">{summary.done && <span className="browse-set-done" title="Done"><DoneIcon /></span>}{browseSetTitle(summary)}</span>
              <span className="browse-set-preview">{truncate(summary.questions[0]?.stems?.[0] || summary.questions[0]?.text || summary.set.source || "Empty set", 110)}</span>
              <span className="browse-set-count">{summary.questions.length}</span>
              {summary.lastSat && <span className="browse-set-sat" title={`Last sat ${new Date(summary.lastSat.submittedAt).toLocaleDateString()}`}><time dateTime={new Date(summary.lastSat.submittedAt).toISOString()}>{shortSatDate(summary.lastSat.submittedAt)}</time>{summary.lastSat.maxScore > 0 && <span className="browse-set-score">{summary.lastSat.score}/{summary.lastSat.maxScore}</span>}</span>}
            </button>
          </div>)}
          {data && !sets.length && <p className="browse-empty">{data.summaries.length ? "No matching sets." : "No sets yet."}</p>}
        </div>}
      </aside>
      <section className="browse-detail" aria-label="Selected set">

        {active ? <>
          <header className="browse-detail-heading">
            <div><button className="small link browse-back" disabled={!!editing} onClick={() => { const next = new URLSearchParams(params); next.delete("set"); setParams(next, { replace: true }); }}>← Sets</button><h2>{browseSetTitle(active)}</h2><span className="muted">{active.questions.length} questions</span>{active.set.bankId && <SetCode bankId={active.set.bankId} />}</div>
            {!editing && <div className="row"><button className="small primary" disabled={deleting || (!content.ready || active.contentReady === false) || !active.questions.length} onClick={() => start(active)}>Practise</button><Link className="button small" to={`/set/${active.set.id}`}>Details</Link><button className="small" disabled={deleting || !content.ready || active.contentReady === false} onClick={() => { select(active.set.id); setEditing(active.set.id); detail.current?.scrollTo(0, 0); }}>{data && isAdmin(data.settings) ? "Edit" : "Edit my copy"}</button>{data && isAdmin(data.settings) && <button className="small danger" disabled={deleting || !content.ready || active.contentReady === false} onClick={() => { setDeleteError(""); setPasscode(""); setPendingDelete(active); }}>Delete</button>}</div>}
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
        </> : <div className="browse-empty">{message && <p className="browse-save-message" role="status" style={{ margin: "0 0 .8rem" }}>{message}</p>}{data ? "Choose a set to view its questions." : "Loading…"}</div>}
      </section>
    </div>

    <AccountGate open={gateOpen} guestSubmitted={gate.guestSubmitted} onClose={() => setGateOpen(false)} />
    <ConfirmDialog open={replacing !== null} title="Replace your unfinished session?" confirmLabel="Start new session" onCancel={() => setReplacing(null)} onConfirm={() => { const s = replacing!; setReplacing(null); begin(s); }}>
      <p>You have a paper in progress. Starting this set replaces it. Answers you already submitted are kept; unsubmitted drafts are discarded.</p>
    </ConfirmDialog>

    <ConfirmDialog open={pendingDelete !== null} title={pendingDelete ? `Delete ${browseSetTitle(pendingDelete)}?` : "Delete set?"} confirmLabel="Delete set" destructive busy={deleting} error={deleteError || null} confirmDisabled={needsPasscode && !passcode.trim()} onCancel={() => { setPendingDelete(null); setDeleteError(""); }} onConfirm={() => { if (pendingDelete) void remove(pendingDelete); }}>
      {pendingDelete && <>
        <p>This removes:</p>
        <ul>
          <li><strong>{pendingDelete.questions.length} question{pendingDelete.questions.length === 1 ? "" : "s"}</strong> and any attempts on them on this device</li>
          {pendingDelete.set.bankId && <li>The set from the <strong>shared library, for everyone</strong></li>}
        </ul>
        <p>This cannot be undone.</p>
        {needsPasscode && <label>Admin passcode<input type="password" autoFocus value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Needed to change the shared library" /></label>}
      </>}
    </ConfirmDialog>
  </div>;
}

const DoneIcon = () => <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>;

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
