import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { getSettings } from "../data/db";
import { AmbossAuthError, ambossPhrases } from "../lib/amboss";
import type { Term } from "../lib/ambossMatch";
import { openAmbossPanel } from "../lib/ambossPanel";
import AmbossLogo from "./AmbossLogo";

/**
 * Look a term up in AMBOSS while practising: type it, and the reference opens in the side
 * pane without leaving the question. Falls back to AMBOSS's own search in a new tab.
 */
export default function AmbossSearch() {
  const settings = useLiveQuery(getSettings, []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Term[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const connected = !!settings?.ambossToken;

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onClick = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const search = async () => {
    const term = query.trim();
    if (!term || busy) return;
    setBusy(true); setError(""); setResults(null);
    try {
      const found = await ambossPhrases(`search:${term.toLowerCase()}`, [term]);
      setResults(found);
      if (found.length === 1) { openAmbossPanel(found[0]); setOpen(false); }
    } catch (e) { setError(e instanceof AmbossAuthError ? e.message : "AMBOSS did not answer. Check your connection and try again."); }
    finally { setBusy(false); }
  };
  const external = `https://next.amboss.com/us/search?q=${encodeURIComponent(query.trim())}`;

  return <details ref={root} className="share-links amboss-search" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
    <summary title="Look something up in AMBOSS"><AmbossLogo /><span>Look up</span></summary>
    <div className="share-links-menu">
      {!connected ? <>
        <small className="muted">Connect your AMBOSS account to read references here without leaving the question.</small>
        <Link to="/settings#amboss">Connect AMBOSS in Settings</Link>
      </> : <>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <input ref={input} aria-label="Search AMBOSS" placeholder="Condition, drug, sign…" value={query} onChange={(e) => { setQuery(e.target.value); setResults(null); setError(""); }} />
          <button type="submit" className="small primary" disabled={busy || !query.trim()}>{busy ? "…" : "Search"}</button>
        </form>
        {error && <small role="alert">{error}</small>}
        {results && results.length > 1 && <div className="amboss-search-results">{results.map((t) => <button key={t.pgId} type="button" className="small" onClick={() => { openAmbossPanel(t); setOpen(false); }}>{t.term}</button>)}</div>}
        {results && results.length === 0 && <small role="status">AMBOSS has no reference matching “{query.trim()}”. Try the condition's full name, or search AMBOSS itself.</small>}
        {query.trim() && <a href={external} target="saq-amboss-article" rel="noopener noreferrer">Search on AMBOSS ↗</a>}
      </>}
    </div>
  </details>;
}
