import { useState } from "react";
import type { QuestionSet } from "../data/types";
import { getPublicLink } from "../lib/publicLinks";

export default function ShareLinks({ set }: { set?: QuestionSet }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<{ url: string; path: string } | null>(null);
  if (!set?.bankId) return null;
  async function copy() {
    if (!set) return;
    setBusy(true); setMessage(""); setLink(null);
    try {
      const result = await getPublicLink(set);
      setLink(result);
      try {
        await navigator.clipboard.writeText(result.url);
        setMessage("Link copied.");
      } catch {
        setMessage("Select and copy the link below.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the link. Try again.");
    } finally { setBusy(false); }
  }
  return <details className="share-links">
    <summary>Share</summary>
    <div className="share-links-menu">
      <button className="small" disabled={busy} onClick={() => void copy()}>Copy set link</button>
      {set.dirty && <small className="muted">Shares the published version.</small>}
      {busy && <small role="status">Preparing link…</small>}
      {message && <small role="status">{message}</small>}
      {link && <><input aria-label="Shared link" readOnly value={link.url} onFocus={e => e.target.select()} /><a href={link.path} target="_blank" rel="noopener noreferrer">Preview shared page</a></>}
    </div>
  </details>;
}
