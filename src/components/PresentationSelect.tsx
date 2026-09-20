import { PRESENTATIONS } from "../data/presentations";

interface Props {
  /** Current presentation id, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  /** Text of the empty first option, e.g. "Move to presentation…". */
  placeholder?: string;
  disabled?: boolean;
  title?: string;
}

/** One dropdown of every presentation, children indented under their parent. */
export default function PresentationSelect({ value, onChange, placeholder = "Presentation…", disabled, title }: Props) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} title={title}>
      <option value="">{placeholder}</option>
      {PRESENTATIONS.map((p) => (
        <option key={p.id} value={p.id}>{p.parent ? "   ↳ " : ""}{p.emoji ? `${p.emoji} ` : ""}{p.name}</option>
      ))}
    </select>
  );
}
