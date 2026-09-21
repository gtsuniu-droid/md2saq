import { AmbossNotesStatus } from "./AmbossNotes";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLocation } from "react-router";
import { db, getSettings } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import { useSession } from "../lib/useSession";
import { refreshSharedNotes, SHARED_OWNER } from "../lib/sharedNotes";
import type { NoteSection } from "../data/types";
import { NOTE_SECTIONS, noteSection } from "../lib/noteModel";
import NoteSectionTabs from "./NoteSectionTabs";
import { NoteContent, NoteReadingControls, useNoteReadingSize } from "./NoteReading";

/** Stays mounted alongside marking/practice. Opening or closing it never navigates the answer page. */
export default function NotesPanel({ onClose }: { onClose: () => void }) {
  const [readingSize, setReadingSize] = useNoteReadingSize();
  const { pathname } = useLocation();
  const session = useSession();
  const [presentation, setPresentation] = useState("abdominal-pain");
  const [section, setSection] = useState<NoteSection>("overview");
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(true);
  const context = useLiveQuery(async () => {
    const [, route, id] = pathname.split("/");
    const qid = route === "mark" ? (await db.attempts.get(id))?.questionId : route === "question" ? id : route === "paper" ? session?.questionIds[session.index] : undefined;
    if (qid) return (await db.questions.get(qid))?.presentations[0];
    if (route === "set" && id) return (await db.questions.where("setId").equals(id).first())?.presentations[0];
    return undefined;
  }, [pathname, session?.index, session?.id]);
  useEffect(() => { if (follow && context) setPresentation(context); }, [context, follow]);
  useEffect(() => { void refreshSharedNotes(presentation).catch(() => undefined); }, [presentation]);
  const notes = useLiveQuery(async () => {
    const owner = (await getSettings()).cloudUser?.uid ?? "";
    return db.notes.where("presentationId").equals(presentation).filter((n) => !n.deleted && (n.ownerId === SHARED_OWNER || n.ownerId === owner || n.ownerId === "")).sortBy("createdAt");
  }, [presentation]);
  const url = `/notes?presentation=${encodeURIComponent(presentation)}&section=${section}`;
  const openWindow = () => {
    const win = window.open(url, "saq-notes-reference", "popup,width=820,height=900");
    win?.focus();
  };
  const visible = (notes ?? []).filter((n) => noteSection(n.section) === section && `${n.title} ${n.kind} ${n.text}`.toLowerCase().includes(search.toLowerCase()));
  return <aside className="notes-dock" aria-label="Notes beside your answer">
    <div className="row spread"><h2>Reference notes</h2><button className="small" onClick={onClose} aria-label="Close notes panel">Close</button></div>
    <div className="row notes-dock-actions"><button className="small" onClick={openWindow}>Open in separate window ↗</button><a className="muted" href={url} target="_blank" rel="noreferrer">Open tab</a></div>
    <p className="muted">Move the separate window to your second screen. Your answer stays here.</p>
    <label htmlFor="reference-presentation">Presentation</label><select id="reference-presentation" value={presentation} onChange={(e) => { setPresentation(e.target.value); setFollow(false); }}>{PRESENTATIONS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <label className="check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow the current question</label>
    <NoteReadingControls size={readingSize} onChange={setReadingSize} />
    <AmbossNotesStatus />
    <NoteSectionTabs id="reference-sections" value={section} notes={notes ?? []} onChange={setSection} />
    <div id="reference-sections-panel" role="tabpanel" aria-labelledby={`reference-sections-tab-${section}`} tabIndex={0}>
    <input type="search" aria-label="Search reference notes" placeholder="Search this section…" value={search} onChange={(e) => setSearch(e.target.value)} />
    <div className="notes-dock-list">
      {visible.map((n) => <details key={n.id} className="note-card"><summary><span className="note-kind">{n.kind}{n.ownerId === SHARED_OWNER ? " · Shared" : " · Private"}</span><strong>{n.title}</strong></summary><div className="note-expanded"><NoteContent doc={n.doc} size={readingSize} />{n.source && <p className="muted note-source">Source: {/^https?:\/\//i.test(n.source) ? <a href={n.source} target="_blank" rel="noreferrer">Open reference</a> : n.source}</p>}<a className="muted" href={url} target="_blank" rel="noreferrer">Edit in Notes ↗</a></div></details>)}
      {notes !== undefined && !visible.length && <div className="notes-empty"><h3>{search ? "No matching notes" : `No ${NOTE_SECTIONS.find((s) => s.id === section)!.label} notes yet`}</h3><a href={url} target="_blank" rel="noreferrer">Add notes in a separate tab ↗</a></div>}
    </div>
    </div>
  </aside>;
}
