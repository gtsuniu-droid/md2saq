import { useEffect, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useSearchParams } from "react-router";
import { db, getSettings, newId } from "../data/db";
import type { PresentationNote } from "../data/types";
import { PRESENTATIONS, PRESENTATION_BY_ID } from "../data/presentations";
import { isAdmin } from "../lib/admin";
import { getSharedNotesIndex, refreshSharedNotesIndex, refreshSharedNotes, saveSharedNote, SHARED_OWNER } from "../lib/sharedNotes";
import { cloudConfigured } from "../lib/firebase";
import { NOTE_KINDS, NOTE_SECTIONS, noteSection } from "../lib/noteModel";
import { getNotesSyncState, saveNote, subscribeNotesSync, syncNotes } from "../lib/notes";
import { AmbossNotesStatus } from "../components/AmbossNotes";
import NoteEditor from "../components/NoteEditor";

import { NoteContent, NoteReadingControls, useNoteReadingSize } from "../components/NoteReading";
import NoteSectionTabs from "../components/NoteSectionTabs";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
const draftKey = (owner: string) => `saq-note-draft:${owner || "device"}`;

export default function NotesPage() {
  const settings = useLiveQuery(getSettings, []);
  if (!settings) return <p className="muted">Loading notes…</p>;
  const owner = settings.cloudUser?.uid ?? "";
  return <NotesWorkspace key={owner} owner={owner} signedIn={!!settings.cloudUser} admin={isAdmin(settings) && !!settings.bankPasscode} />;
}

function NotesWorkspace({ owner, signedIn, admin }: { owner: string; signedIn: boolean; admin: boolean }) {
  const [readingSize, setReadingSize] = useNoteReadingSize();
  const [params, setParams] = useSearchParams();
  const selected = params.get("presentation") ?? "abdominal-pain";
  const section = noteSection(params.get("section"));
  const sectionInfo = NOTE_SECTIONS.find((s) => s.id === section)!;
  const presentation = PRESENTATION_BY_ID.get(selected);
  const [library, setLibrary] = useState<"shared" | "private">("shared");
  const [sharedError, setSharedError] = useState("");
  const sharedIndex = useLiveQuery(getSharedNotesIndex, []);
  const [indexError, setIndexError] = useState("");
  const refreshIndex = () => { setIndexError(""); void refreshSharedNotesIndex().catch((e) => setIndexError(e.message)); };
  const refreshPresentation = () => { setSharedError(""); void refreshSharedNotes(selected).catch((e) => setSharedError(e.message)); };
  const refresh = () => { refreshIndex(); refreshPresentation(); };
  useEffect(() => { refreshIndex(); }, []);
  useEffect(() => { refreshPresentation(); }, [selected]);
  const notes = useLiveQuery(() => db.notes.filter((n) => (library === "shared" ? n.ownerId === SHARED_OWNER : n.ownerId === owner || n.ownerId === "")).toArray(), [owner, library]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState("");
  const [trash, setTrash] = useState(false);
  const [draft, setDraft] = useState<PresentationNote | null>(() => {
    try { return JSON.parse(localStorage.getItem(draftKey(owner)) ?? "null"); } catch { return null; }
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingImages, setAddingImages] = useState(false);
  const sync = useSyncExternalStore(subscribeNotesSync, getNotesSyncState);
  useEffect(() => {
    if (!draft) return;
    try { localStorage.setItem(draftKey(owner), JSON.stringify(draft)); }
    catch { setError("This draft could not be backed up in the browser. Keep this page open until you save it."); }
  }, [draft, owner]);
  const finishDraft = () => {
    localStorage.removeItem(draftKey(owner));
    setDraft(null);
  };
  const syncSaved = () => {
    if (signedIn) void syncNotes().catch(() => undefined);
  };
  const begin = (note?: PresentationNote) => {
    if (draft && !confirm("Replace your unfinished draft?")) return;
    setError(""); setMessage("");
    setDraft(note ? { ...note } : {
      id: library === "shared" ? `shared-${newId()}` : newId(), presentationId: selected, section, kind: kind || "Lecture Notes", title: "", source: "",
      doc: EMPTY_DOC, text: "", ownerId: library === "shared" ? SHARED_OWNER : owner, createdAt: Date.now(), _m: 0, revision: "", deleted: false,
    });
  };
  const save = async () => {
    if (!draft || addingImages) return;
    setSaving(true); setError("");
    try {
      const saved = draft.ownerId === SHARED_OWNER ? await saveSharedNote(draft) : await saveNote(draft, draft.revision || undefined);
      finishDraft(); setMessage(saved.ownerId === SHARED_OWNER ? "Published to the shared website library." : "Note saved on this device.");
      setExpanded((prev) => new Set([...prev, saved.id]));
      setLibrary(saved.ownerId === SHARED_OWNER ? "shared" : "private");
      setParams({ presentation: saved.presentationId, section: noteSection(saved.section) }); setKind(""); setTrash(false);
      syncSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save. Your draft is still here."); }
    finally { setSaving(false); }
  };
  const archive = async (note: PresentationNote) => {
    try {
      const next = { ...note, deleted: !note.deleted };
      if (note.ownerId === SHARED_OWNER) await saveSharedNote(next); else await saveNote(next, note.revision);
      setMessage(note.deleted ? "Note restored." : "Moved to deleted notes. You can restore it any time.");
      syncSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update note."); }
  };
  const q = search.trim().toLowerCase();
  const available = (notes ?? []).filter((n) => n.presentationId === selected && n.deleted === trash);
  const sectionNotes = available.filter((n) => noteSection(n.section) === section);
  const kinds = [...new Set(sectionNotes.map((n) => n.kind))].sort();
  const visible = sectionNotes.filter((n) => (!kind || n.kind === kind) && (!q || `${n.title} ${n.kind} ${n.text}`.toLowerCase().includes(q))).sort((a, b) => a.createdAt - b.createdAt);
  const filteredPresentations = PRESENTATIONS.filter((p) => !q || p.name.toLowerCase().includes(q) || (notes ?? []).some((n) => n.presentationId === p.id && !n.deleted && `${n.title} ${n.kind} ${n.text}`.toLowerCase().includes(q)));
  const toggle = (id: string) => setExpanded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <div className="notes-page">
    <div className="row spread notes-heading"><div><h1>Notes</h1><p className="muted">Your reference library, one presentation at a time.</p></div>
      <div className="row">
        <span className="muted" role="status">{library === "shared" ? "Shared website library" : !signedIn ? "Saved on this device" : sync.status === "syncing" ? "Syncing notes…" : sync.status === "synced" ? "Notes synced" : sync.status === "error" ? "Sync needs attention" : "Private to your account"}</span>
        {library === "private" && signedIn && <button className="small" disabled={sync.status === "syncing"} onClick={() => { void syncNotes().catch(() => undefined); }}>Sync notes</button>}
      </div>
    </div>
    <div className="seg" role="group" aria-label="Notes library"><button className={library === "shared" ? "on" : ""} onClick={() => { setLibrary("shared"); setKind(""); setTrash(false); }}>Shared library</button><button className={library === "private" ? "on" : ""} onClick={() => { setLibrary("private"); setKind(""); setTrash(false); }}>My private notes</button></div>
    {library === "shared" && <p className="notes-notice">Shared with everyone using this website. {admin ? "Your saved edits publish to the library." : "An admin can add and edit notes."} <button className="small" onClick={refresh}>Refresh library</button></p>}
    {library === "shared" && (sharedError || indexError) && <p role="alert">{sharedError || indexError}</p>}
    {library === "private" && !signedIn && <p className="notes-notice"><Link to="/settings">Sign in in Settings</Link> {cloudConfigured() ? "to sync your notes between devices." : "when cloud sync is configured to keep your notes across devices."} Your notes stay private.</p>}
    {sync.status === "error" && signedIn && <p role="alert" className="notes-notice">Saved notes are still on this device. Cloud sync failed: {sync.message}</p>}
    <label className="sr-only" htmlFor="notes-search">Search presentations and notes</label>
    <input id="notes-search" type="search" className="notes-search" placeholder="Search presentations and notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
    {error && !draft && <p role="alert" className="notes-error">{error}</p>}
    {message && <p role="status" className="muted">{message}</p>}
    {draft?.ownerId === SHARED_OWNER && draft.revision && notes?.some((n) => n.id === draft.id && n.revision !== draft.revision) && <p role="alert" className="notes-notice">This note was updated elsewhere. Your draft is safe here; copy your changes before reopening the latest version.</p>}
    {draft && <form className="note-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="row spread"><h2>{draft.revision ? "Edit note" : "New note"}</h2><span className="muted">{draft.ownerId === SHARED_OWNER ? "Shared note · saved edits are public" : "Private draft kept on this device"}</span></div>
      <div className="note-fields">
        <label>Presentation<select aria-label="Note presentation" disabled={draft.ownerId === SHARED_OWNER && !!draft.revision} value={draft.presentationId} onChange={(e) => setDraft({ ...draft, presentationId: e.target.value })}>{PRESENTATIONS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Section<select aria-label="Note section" value={noteSection(draft.section)} onChange={(e) => setDraft({ ...draft, section: noteSection(e.target.value) })}>{NOTE_SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label} — {s.description}</option>)}</select></label>
        <label>Note type<input aria-label="Note type" list="note-kinds" maxLength={80} required value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} /></label>
      </div>
      <datalist id="note-kinds">{[...new Set([...NOTE_KINDS, ...(notes ?? []).map((n) => n.kind)])].map((k) => <option key={k} value={k} />)}</datalist>
      <label>Title<input aria-label="Note title" type="text" autoFocus required maxLength={200} placeholder="e.g. Approach to abdominal pain" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
      <NoteEditor key={draft.id} initial={draft.doc} onBusyChange={setAddingImages} onChange={(doc, text) => setDraft((d) => d ? { ...d, doc, text } : d)} />
      <label>Source (optional)<input aria-label="Note source" type="text" placeholder="Book, lecture, or page link" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} /></label>
      {error && <p role="alert" className="notes-error">{error} Your draft has been kept.</p>}
      <div className="row note-form-actions"><button className="primary" disabled={saving || addingImages}>{addingImages ? "Adding pictures…" : saving ? "Saving…" : draft.ownerId === SHARED_OWNER ? "Publish shared note" : "Save note"}</button><button type="button" disabled={saving || addingImages} onClick={() => { if (confirm("Discard this unfinished draft?")) finishDraft(); }}>Discard draft</button></div>
    </form>}
    <div className="notes-layout">
      <aside className="notes-sidebar" aria-label="Core presentations"><div className="notes-sidebar-heading">Core presentations</div>
        {filteredPresentations.map((p) => {
          const count = (notes ?? []).filter((n) => n.presentationId === p.id && !n.deleted).length;
          const savedInCloud = library === "shared" && (sharedIndex?.includes(p.id) || (notes ?? []).some((n) => n.presentationId === p.id));
          return <button key={p.id} className={p.id === selected ? "selected" : ""} aria-current={p.id === selected ? "page" : undefined} onClick={() => { setParams({ presentation: p.id, section }); setKind(""); setTrash(false); }}><span>{p.emoji} {p.name}</span><small title={savedInCloud ? "Notes saved in the shared library. Open this presentation to view them." : undefined}>{savedInCloud ? "Saved" : count || "—"}</small></button>;
        })}
        {!filteredPresentations.length && <p className="muted">No matching presentations.</p>}
      </aside>
      <section className="notes-main" aria-label="Presentation notes">
        <div className="row spread"><div><div className="notes-eyebrow">CORE PRESENTATION</div><h2 className="notes-presentation-title">{presentation?.emoji} {presentation?.name ?? "Choose a presentation"}</h2></div>
          <button className="primary" disabled={!presentation || saving || (library === "shared" && !admin)} onClick={() => begin()}>+ Add note</button></div>
        <NoteSectionTabs id="presentation-sections" value={section} notes={available} onChange={(next) => { setParams({ presentation: selected, section: next }); setKind(""); }} />
        <div id="presentation-sections-panel" role="tabpanel" aria-labelledby={`presentation-sections-tab-${section}`} tabIndex={0}>
        <p className="muted">{sectionInfo.description}</p>
        <NoteReadingControls size={readingSize} onChange={setReadingSize} />
        <AmbossNotesStatus />
        <div className="note-kind-pills" aria-label="Filter note types"><button aria-pressed={!kind} onClick={() => setKind("")}>All types <span>{sectionNotes.length}</span></button>{kinds.map((k) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(kind === k ? "" : k)}>{k}</button>)}</div>
        <div className="row spread notes-list-tools"><span className="muted">{visible.length} {trash ? "deleted " : ""}note{visible.length === 1 ? "" : "s"}</span><span className="row"><button className="small link" onClick={() => setExpanded(new Set(visible.map((n) => n.id)))}>Expand all</button><button className="small link" onClick={() => setExpanded(new Set())}>Collapse all</button></span></div>
        {notes === undefined ? <p>Loading…</p> : !visible.length ? <div className="notes-empty"><span aria-hidden="true">✎</span><h3>{q || kind ? "No matching notes" : trash ? "No deleted notes" : `No ${sectionInfo.label} notes yet`}</h3><p>{q || kind ? "Try another search or note type." : "Add a note to this section, then paste or write your content."}</p>{!trash && !q && !kind && <div className="row notes-suggestions">{["Lecture Notes", "First Aid", "Sketchy", "My Notes"].map((k) => <span key={k}>{k}</span>)}</div>}</div> : visible.map((n) => {
          const open = expanded.has(n.id);
          return <article key={n.id} className={"note-card" + (open ? " open" : "")}>
            <button className="note-toggle" aria-expanded={open} aria-controls={`note-${n.id}`} onClick={() => toggle(n.id)}><span className="note-caret">{open ? "▾" : "▸"}</span><span><span className="note-kind">{n.kind}</span><strong>{n.title}</strong></span></button>
            {open && <div id={`note-${n.id}`} className="note-expanded"><NoteContent doc={n.doc} size={readingSize} />
              {n.source && <p className="muted note-source">Source: {/^https?:\/\//i.test(n.source) ? <a href={n.source} target="_blank" rel="noreferrer">Open reference</a> : n.source}</p>}
              <div className="row spread note-footer"><span className="muted">Updated {new Date(n._m).toLocaleDateString()}</span><span className="row">{(library === "private" || admin) && <>{!n.deleted && <button className="small" onClick={() => begin(n)}>Edit</button>}<button className="small link" onClick={() => { void archive(n); }}>{n.deleted ? "Restore" : "Delete"}</button></>}</span></div>
            </div>}
          </article>;
        })}
        </div>
        <button className="small link notes-trash" onClick={() => { setTrash(!trash); setKind(""); }}>{trash ? "Back to notes" : `Deleted notes (${(notes ?? []).filter((n) => n.presentationId === selected && n.deleted).length})`}</button>
      </section>
    </div>
  </div>;
}
