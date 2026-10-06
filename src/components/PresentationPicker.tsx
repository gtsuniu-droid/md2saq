import { PRESENTATIONS } from "../data/presentations";

interface Props {
  selected: string[];
  onChange: (ids: string[]) => void;
  suggested?: string[];
}

export default function PresentationPicker({ selected, onChange, suggested = [] }: Props) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const ordered = [
    ...PRESENTATIONS.filter((p) => selected.includes(p.id) || suggested.includes(p.id)),
    ...PRESENTATIONS.filter((p) => !selected.includes(p.id) && !suggested.includes(p.id)),
  ];
  return (
    <details>
      <summary style={{ cursor: "pointer" }}>
        {selected.length === 0 ? <span className="muted">No presentation tagged</span> : null}
        {selected.map((id) => (
          <button type="button" key={id} className="chip on" aria-label={`Remove ${PRESENTATIONS.find((p) => p.id === id)?.name ?? id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(id); }}>
            {PRESENTATIONS.find((p) => p.id === id)?.name ?? id} ×
          </button>
        ))}
        {suggested.filter((id) => !selected.includes(id)).map((id) => (
          <button type="button" key={id} className="chip" title="Suggested" aria-label={`Add ${PRESENTATIONS.find((p) => p.id === id)?.name ?? id}, suggested presentation`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(id); }}>
            + {PRESENTATIONS.find((p) => p.id === id)?.name ?? id}
          </button>
        ))}
      </summary>
      <div style={{ marginTop: "0.4rem" }}>
        {ordered.map((p) => (
          <button type="button" key={p.id} className={"chip" + (selected.includes(p.id) ? " on" : "")} aria-pressed={selected.includes(p.id)} onClick={() => toggle(p.id)}>
            {p.parent ? "↳ " : ""}{p.name}
          </button>
        ))}
      </div>
    </details>
  );
}
