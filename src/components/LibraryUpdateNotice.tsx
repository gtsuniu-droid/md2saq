import { useState } from "react";
import { takeBankUpdate } from "../lib/bank";

/**
 * Shown over a set this device holds unpublished edits to while the bank has a newer version:
 * one line, take the update or keep what is here. Keeping is remembered for that revision.
 */
const key = (setId: string) => `library.keepMine.${setId}`;
export const keptMine = (setId: string, revision: number): boolean => { try { return localStorage.getItem(key(setId)) === String(revision); } catch { return false; } };

export default function LibraryUpdateNotice({ setId, revision }: { setId: string; revision: number }) {
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState(() => keptMine(setId, revision));
  if (kept) return null;
  const keep = () => { try { localStorage.setItem(key(setId), String(revision)); } catch { /* fine */ } setKept(true); };
  const take = async () => { setBusy(true); try { await takeBankUpdate(setId); } finally { setBusy(false); } };
  return <p className="library-update" role="status">
    <span>This set was updated in the library after your edits here.</span>
    <button type="button" className="small" disabled={busy} onClick={() => void take()}>{busy ? "Updating…" : "Use the update"}</button>
    <button type="button" className="small link" disabled={busy} onClick={keep}>Keep mine</button>
  </p>;
}
