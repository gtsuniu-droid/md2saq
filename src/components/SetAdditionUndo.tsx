import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings } from "../data/db";
import { restoreSetAddition, undoSetAddition } from "../lib/setAdditionUndo";
import { bankErrorMessage } from "../lib/share";

export default function SetAdditionUndo({ disabled = false, onChanged }: { disabled?: boolean; onChanged?: () => void }) {
  const batches = useLiveQuery(async () => {
    const owner = (await getSettings()).cloudUser?.uid ?? "";
    return (await db.setAdditions.where("ownerId").equals(owner).toArray()).sort((a, b) => b.createdAt - a.createdAt);
  }, []);
  const latest = batches?.find((b) => b.status === "saved" || b.status === "undoing");
  const recoverable = batches?.find((b) => b.undoneIds.length > 0);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const target = batches?.find((b) => b.id === preview);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || disabled || busy || !latest || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z") return;
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      event.preventDefault(); setPreview(latest.id); setError("");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [latest, disabled, busy]);
  useEffect(() => { if (preview) panel.current?.focus(); }, [preview]);
  const run = async (id: string, restore: boolean) => {
    if (busy || disabled) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (restore) await restoreSetAddition(id); else await undoSetAddition(id);
      setPreview(null);
      setMessage(restore ? "Sets restored on this device. Use Publish local changes to share them again." : "Addition undone. A recovery copy is kept on this device.");
    } catch (e) { setError(bankErrorMessage(e)); }
    finally { setBusy(false); onChanged?.(); }
  };
  return <section className="addition-undo" aria-label="Undo additions">
    <div className="row spread">
      <div><strong>Recent additions</strong><p className="muted">Undo the last saved batch, including a multi-set import. Saved on this device.</p></div>
      {latest && <button disabled={busy || disabled} onClick={() => { setPreview(latest.id); setError(""); }} title="Ctrl+Z / ⌘Z outside a text field">
        {latest.status === "undoing" ? "Finish undo" : "Undo latest addition"} ({latest.items.length} {latest.items.length === 1 ? "set" : "sets"})
      </button>}
    </div>
    {!batches?.length && <p className="muted">New additions will appear here. Earlier imports have no batch record.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error} {latest?.status === "undoing" && `${latest.undoneIds.length} of ${latest.items.length} sets removed. You can retry or restore the removed sets.`}</p>}
    {target && <div className="undo-preview card" ref={panel} tabIndex={-1} role="region" aria-label="Review addition to undo" onKeyDown={(e) => { if (e.key === "Escape" && !busy) setPreview(null); }}>
      <strong>Undo {target.items.length} {target.items.length === 1 ? "set" : "sets"} added {new Date(target.createdAt).toLocaleString()}?</strong>
      <p>This removes this batch from the library, including its shared-bank copies. Sets edited or used in a study session on this device are protected.</p>
      <ul>{target.items.map(({ set }) => <li key={set.id}>{set.source || set.name}{target.undoneIds.includes(set.id) ? " (removed)" : ""}</li>)}</ul>
      <div className="row"><button className="danger" disabled={busy || disabled} onClick={() => void run(target.id, false)}>{busy ? "Undoing…" : `Undo ${target.items.length} ${target.items.length === 1 ? "set" : "sets"}`}</button><button disabled={busy} onClick={() => setPreview(null)}>Cancel</button></div>
    </div>}
    {recoverable && <button className="small" disabled={busy || disabled} onClick={() => void run(recoverable.id, true)}>Restore removed sets ({recoverable.undoneIds.length})</button>}
    {!!batches?.length && <details><summary>View addition history</summary><ol>{batches.slice(0, 10).map((b) => <li key={b.id}>{b.label}, {b.items.length} {b.items.length === 1 ? "set" : "sets"}, {new Date(b.createdAt).toLocaleString()}, {b.status === "saved" ? "added" : b.status === "undoing" ? "undo incomplete" : b.status}</li>)}</ol></details>}
  </section>;
}
