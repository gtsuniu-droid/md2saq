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
          <span key={id} className="chip on" onClick={(e) => { e.preventDefault(); toggle(id); }}>
            {PRESENTATIONS.find((p) => p.id === id)?.name ?? id} ×
          </span>
        ))}
        {suggested.filter((id) => !selected.includes(id)).map((id) => (
          <span key={id} className="chip" title="Suggested" onClick={(e) => { e.preventDefault(); toggle(id); }}>
            + {PRESENTATIONS.find((p) => p.id === id)?.name ?? id}
          </span>
        ))}
      </summary>
      <div style={{ marginTop: "0.4rem" }}>
        {ordered.map((p) => (
          <span key={p.id} className={"chip" + (selected.includes(p.id) ? " on" : "")} onClick={() => toggle(p.id)}>
            {p.parent ? "↳ " : ""}{p.name}
          </span>
        ))}
      </div>
    </details>
  );
}
