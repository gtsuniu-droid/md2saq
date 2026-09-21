import type { NoteSection, PresentationNote } from "../data/types";
import { NOTE_SECTIONS, noteSection } from "../lib/noteModel";

export default function NoteSectionTabs({ id, value, notes, onChange }: {
  id: string; value: NoteSection; notes: PresentationNote[]; onChange: (section: NoteSection) => void;
}) {
  return <div className="note-section-tabs" role="tablist" aria-label="Clinical note sections">
    {NOTE_SECTIONS.map((section, index) => {
      const count = notes.filter((n) => noteSection(n.section) === section.id).length;
      return <button key={section.id} id={`${id}-tab-${section.id}`} type="button" role="tab"
        aria-selected={value === section.id} aria-controls={`${id}-panel`} tabIndex={value === section.id ? 0 : -1}
        title={section.description} onClick={() => onChange(section.id)} onKeyDown={(e) => {
          const next = e.key === "ArrowRight" ? (index + 1) % NOTE_SECTIONS.length
            : e.key === "ArrowLeft" ? (index + NOTE_SECTIONS.length - 1) % NOTE_SECTIONS.length
            : e.key === "Home" ? 0 : e.key === "End" ? NOTE_SECTIONS.length - 1 : -1;
          if (next < 0) return;
          e.preventDefault();
          onChange(NOTE_SECTIONS[next].id);
          document.getElementById(`${id}-tab-${NOTE_SECTIONS[next].id}`)?.focus();
        }}>{section.label}<span className="note-section-count" aria-hidden="true">{count}</span></button>;
    })}
  </div>;
}
