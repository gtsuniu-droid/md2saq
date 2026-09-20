import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { db, getSettings, patchSettings } from "../data/db";
import PasscodeGate from "../components/PasscodeGate";
import { CreateTools } from "./CreatePage";
import { BankPasscodeError, deleteBankSet, listBank, syncFromBank, type BankEntry } from "../lib/bank";
import { formatDate } from "../lib/questions";
import { loadSummaries } from "../lib/sets";
import { fullLabel } from "../lib/tree";
import { bankErrorMessage, pushToBank } from "../lib/share";
import { recordDeletes } from "../lib/sync";
import { moveSetToPresentation } from "../lib/movePresentation";
import { presentationName } from "../data/presentations";
import PresentationSelect from "../components/PresentationSelect";

/**
 * The single place for building the bank: add sets (drop or paste), edit,
 * delete. Everything saved here is pushed to the shared bank when the site
 * can reach it, and everyone's library follows.
 */
export default function MasterPage() {
  return (
    <PasscodeGate title="Admin" blurb="Enter the admin passcode to add, edit and remove question sets for everyone.">
      <MasterContents />
    </PasscodeGate>
  );
}

function MasterContents() {
  const nav = useNavigate();
  const summaries = useLiveQuery(loadSummaries, []);
  const [bank, setBank] = useState<BankEntry[] | null>(null);
  const [bankError, setBankError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [bulkTag, setBulkTag] = useState("");

  const refreshBank = async () => {
    try {
      setBank(await listBank());
      await syncFromBank();
      setBankError(null);
    } catch (e) {
      setBank(null);
      if (e instanceof BankPasscodeError) {
        // The saved passcode is wrong: forget it so the gate asks again.
        await patchSettings({ bankPasscode: undefined });
        return;
      }
      setBankError("The server is not reachable from here, so changes stay on this device until it is.");
    }
  };
  useEffect(() => { void refreshBank(); }, []);

  const rows = useMemo(() => {
    if (!summaries) return [];
    const q = filter.trim().toLowerCase();
    return [...summaries]
      .filter((s) => !q || [fullLabel(s), s.set.source ?? "", ...(s.set.tags ?? [])].join(" ").toLowerCase().includes(q))
      .sort((a, b) => fullLabel(a).localeCompare(fullLabel(b), undefined, { numeric: true }));
  }, [summaries, filter]);

  if (!summaries) return null;
  const bankById = new Map((bank ?? []).map((e) => [e.id, e]));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.set.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.set.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pushAll = async () => {
    setBusy("push");
    setMessage(null);
    let n = 0;
    try {
      for (const s of summaries) {
        const entry = bankById.get(s.set.bankId ?? "");
        // Never shared, edited since, or removed from the bank behind our back.
        const stale = !s.set.bankId || s.set.dirty || !entry;
        if (stale) {
          await pushToBank(s.set.id);
          n++;
        }
      }
      setMessage(n ? `Published ${n} set${n === 1 ? "" : "s"}.` : "Everything is already published.");
      await refreshBank();
    } catch (e) {
      setMessage(`Could not publish: ${bankErrorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const removeMany = async (ids: string[]) => {
    const targets = summaries.filter((x) => ids.includes(x.set.id));
    if (targets.length === 0) return;
    const what = targets.length === 1 ? fullLabel(targets[0]) : `${targets.length} sets`;
    if (!confirm(`Delete ${what} for everyone, with every attempt and mark on this device?`)) return;
    setBusy("delete");
    try {
      const code = (await getSettings()).bankPasscode ?? "";
      for (const s of targets) {
        if (s.set.bankId && bankById.has(s.set.bankId)) await deleteBankSet(s.set.bankId, code);
        const qids = s.questions.map((q) => q.id);
        const goneAttempts = (await db.attempts.where("questionId").anyOf(qids).primaryKeys()) as string[];
        const goneMarks = (await db.marks.where("questionId").anyOf(qids).primaryKeys()) as string[];
        await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
          await db.marks.where("questionId").anyOf(qids).delete();
          await db.attempts.where("questionId").anyOf(qids).delete();
          await db.questions.bulkDelete(qids);
          await db.sets.delete(s.set.id);
        });
        await recordDeletes("attempts", goneAttempts);
        await recordDeletes("marks", goneMarks);
      }
      setSelected(new Set());
      await refreshBank();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = (setId: string) => removeMany([setId]);

  const publishSelected = async () => {
    setBusy("push");
    setMessage(null);
    let n = 0;
    try {
      for (const id of selected) {
        await pushToBank(id);
        n++;
      }
      setMessage(`Published ${n} set${n === 1 ? "" : "s"}.`);
      await refreshBank();
    } catch (e) {
      setMessage(`Could not publish: ${bankErrorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const moveSelected = async (presentationId: string) => {
    if (!presentationId || selected.size === 0) return;
    setBusy("move");
    try {
      for (const id of selected) await moveSetToPresentation(id, presentationId);
      setMessage(`Moved ${selected.size} set${selected.size === 1 ? "" : "s"} to ${presentationName(presentationId)}. Publish to share the change.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const tagSelected = async () => {
    const tags = bulkTag.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0 || selected.size === 0) return;
    setBusy("tag");
    try {
      for (const id of selected) {
        const set = await db.sets.get(id);
        if (!set) continue;
        const merged = [...(set.tags ?? [])];
        for (const t of tags) if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
        await db.sets.update(id, { tags: merged, updatedAt: Date.now(), dirty: true });
      }
      setBulkTag("");
      setMessage(`Tagged ${selected.size} set${selected.size === 1 ? "" : "s"}. Publish to share the change.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Admin</h1>
        <span className="muted">{bank ? `${bank.length} sets published` : bankError ? "offline" : "checking…"}</span>
      </div>
      {bankError && <p className="muted">{bankError}</p>}
      {message && <p>{message}</p>}

      <details className="section" open={summaries.length === 0}>
        <summary><h2>Add</h2></summary>
        <CreateTools embedded onSaved={() => void refreshBank()} />
      </details>

      <details className="section" open>
        <summary><h2>Sets</h2></summary>
        <div className="row" style={{ margin: "0.4rem 0 0.6rem" }}>
          <input type="search" placeholder="Filter sets" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="muted">{selected.size ? `${selected.size} selected` : `${rows.length} sets`}</span>
          <span style={{ flex: 1 }} />
          {selected.size > 0 ? (
            <>
              <input type="text" placeholder="Tag to add, e.g. Dizziness::Vestibular" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void tagSelected(); }} style={{ minWidth: "16rem" }} />
              <button className="small" onClick={tagSelected} disabled={busy !== null || !bulkTag.trim()}>Add tag</button>
              <PresentationSelect value="" onChange={moveSelected} disabled={busy !== null} placeholder="Move to presentation…" title="Each set takes the next number in that presentation" />
              <button className="small" onClick={publishSelected} disabled={busy !== null}>Publish selected</button>
              <button className="small danger" onClick={() => removeMany([...selected])} disabled={busy !== null}>Delete selected</button>
              <button className="small link" onClick={() => setSelected(new Set())}>Clear</button>
            </>
          ) : (
            <button className="small" onClick={pushAll} disabled={busy !== null || !bank}>Publish local changes</button>
          )}
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: "1.6rem" }}><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all shown" /></th>
              <th>Set</th><th>Questions</th><th>Status</th><th>Updated</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const entry = bankById.get(s.set.bankId ?? "");
              const status = !s.set.bankId ? "not published" : !bank ? "" : !entry ? "not found on the server" : s.set.dirty ? "edits not published" : "published";
              return (
                <tr key={s.set.id} className={selected.has(s.set.id) ? "selected" : ""}>
                  <td><input type="checkbox" checked={selected.has(s.set.id)} onChange={() => toggle(s.set.id)} /></td>
                  <td>
                    <Link to={`/set/${s.set.id}`}>{fullLabel(s)}</Link>
                    <div className="muted">{[(s.set.tags ?? []).join(", "), s.set.source].filter(Boolean).join(", ")}</div>
                  </td>
                  <td>{s.questions.length}</td>
                  <td className="muted">{status}</td>
                  <td className="muted">{formatDate(s.set.updatedAt ?? s.set.createdAt)}</td>
                  <td className="row" style={{ justifyContent: "flex-end" }}>
                    <button className="small" onClick={() => nav(`/set/${s.set.id}/edit`)}>Edit</button>
                    <button className="small danger" onClick={() => remove(s.set.id)} disabled={busy !== null}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && summaries.length > 0 && <p className="muted">Nothing matches the filter.</p>}
      </details>
      {summaries.length === 0 && <p className="muted">No sets yet. Drop a folder or paste a paper above.</p>}
    </div>
  );
}
