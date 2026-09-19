import { useId, useState } from "react";
import { displayName } from "../lib/tree";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  /** One-click suggestions, shown until accepted. */
  suggestions?: string[];
  /** Autocomplete vocabulary: existing tags, branches and presentation names. */
  known?: string[];
  placeholder?: string;
  compact?: boolean;
}

/**
 * Tags as chips. Type to add (Enter or comma), pick from autocomplete, or
 * click a suggestion. "Presentation::Topic" nests the set in Browse.
 */
export default function TagEditor({ value, onChange, suggestions = [], known = [], placeholder = "Add a tag, or Presentation::Topic to nest", compact = false }: Props) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  const add = (raw: string) => {
    const tags = raw.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) return;
    const next = [...value];
    for (const t of tags) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    onChange(next);
    setDraft("");
  };
  const remove = (t: string) => onChange(value.filter((x) => x !== t));
  const pending = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <div className={"tag-editor" + (compact ? " compact" : "")}>
      <div className="tag-chips">
        {value.map((t) => (
          <span key={t} className={"chip on" + (t.includes("::") ? " nested" : "")} title={t}>
            {t.split("::").map(displayName).join(" › ")}
            <button type="button" className="x" aria-label={`Remove ${t}`} onClick={() => remove(t)}>×</button>
          </span>
        ))}
        <input
          type="text"
          list={listId}
          value={draft}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && draft === "" && value.length) {
              remove(value[value.length - 1]);
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
        <datalist id={listId}>
          {known.map((k) => <option key={k} value={k} />)}
        </datalist>
      </div>
      {pending.length > 0 && (
        <div className="tag-suggest">
          <span className="muted">Suggested:</span>
          {pending.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => add(s)}>+ {s}</button>
          ))}
          {pending.length > 1 && <button type="button" className="small link" onClick={() => add(pending.join(","))}>add all</button>}
        </div>
      )}
    </div>
  );
}
