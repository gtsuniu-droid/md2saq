import SetAdditionUndo from "../components/SetAdditionUndo";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { db, patchSettings } from "../data/db";
import PasscodeGate from "../components/PasscodeGate";
import { CreateTools } from "./CreatePage";
import { BankPasscodeError, ensureSetContent, listBank, syncFromBank, type BankEntry } from "../lib/bank";
import { formatDate } from "../lib/questions";
import { loadSummaries } from "../lib/sets";
import { fullLabel } from "../lib/tree";
import { bankErrorMessage, deleteSetEverywhere, pushToBank, savedPasscode } from "../lib/share";
import { moveSetToPresentation } from "../lib/movePresentation";
import { presentationName } from "../data/presentations";
import PresentationSelect from "../components/PresentationSelect";
import ConfirmDialog from "../components/ConfirmDialog";
import PeopleSection from "../components/PeopleSection";

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
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: "set" | "questions" | "status" | "added" | "updated"; direction: "asc" | "desc" }>({ key: "set", direction: "asc" });
  const bankById = useMemo(() => new Map((bank ?? []).map((e) => [e.id, e])), [bank]);
  const statusOf = (s: NonNullable<typeof summaries>[number]) => !s.set.bankId ? "not published" : !bank ? "" : !bankById.has(s.set.bankId) ? "not found on the server" : s.set.dirty ? "edits not published" : "published";
  const addedAt = (s: NonNullable<typeof summaries>[number]) => bankById.get(s.set.bankId ?? "")?.uploadedAt ?? (!s.set.bankId ? s.set.createdAt : undefined);
  const updatedAt = (s: NonNullable<typeof summaries>[number]) => Math.max(bankById.get(s.set.bankId ?? "")?.updatedAt ?? 0, s.set.updatedAt ?? 0) || s.set.createdAt;

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
      .sort((a, b) => {
        const value = (s: NonNullable<typeof summaries>[number]): string | number | undefined => sort.key === "questions" ? s.questions.length : sort.key === "status" ? statusOf(s) : sort.key === "added" ? addedAt(s) : sort.key === "updated" ? updatedAt(s) : fullLabel(s);
        const av = value(a), bv = value(b);
        if (av === undefined || bv === undefined) return av === bv ? 0 : av === undefined ? 1 : -1;
        const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return (sort.direction === "asc" ? result : -result) || a.set.id.localeCompare(b.set.id);
      });
  }, [summaries, filter, sort, bankById, bank]);

  if (!summaries) return null;
  const sortColumn = (key: typeof sort.key) => setSort((s) => ({ key, direction: s.key === key ? s.direction === "asc" ? "desc" : "asc" : key === "added" || key === "updated" ? "desc" : "asc" }));
  const heading = (key: typeof sort.key, label: string) => <th scope="col" aria-sort={sort.key === key ? sort.direction === "asc" ? "ascending" : "descending" : "none"} title={key === "added" ? "First published, or created locally if unpublished" : undefined}><button className="sortable-heading" onClick={() => sortColumn(key)}>{label}<span className="sort-direction" data-active={sort.key === key || undefined} aria-hidden="true">{sort.key === key ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>;
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
    setBusy("delete");
    setDeleteError(null);
    let done = 0;
    try {
      for (const s of targets) { await deleteSetEverywhere(s.set.id); done++; }
      setSelected(new Set());
      setPendingDelete(null);
      setMessage(`Deleted ${done === 1 ? fullLabel(targets[0]) : `${done} sets`}.`);
      await refreshBank();
    } catch (e) {
      setDeleteError(`${done ? `Deleted ${done}, then stopped: ` : "Could not delete: "}${bankErrorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const remove = (setId: string) => setPendingDelete([setId]);
  const pendingTargets = pendingDelete ? summaries.filter((x) => pendingDelete.includes(x.set.id)) : [];

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

  /** Publish every selected set after a bulk change; says what happened. */
  const publishAfter = async (did: string): Promise<void> => {
    const n = selected.size;
    const what = `${did} ${n} set${n === 1 ? "" : "s"}`;
    if (!(await savedPasscode())) {
      setMessage(`${what}. Publish to share the change.`);
      return;
    }
    try {
      for (const id of selected) await pushToBank(id);
      setMessage(`${what} and published.`);
      await refreshBank();
    } catch (e) {
      setMessage(`${what} here, not published: ${bankErrorMessage(e)}`);
    }
  };

  const moveSelected = async (presentationId: string) => {
    if (!presentationId || selected.size === 0) return;
    setBusy("move");
    try {
      for (const id of selected) await moveSetToPresentation(id, presentationId);
      await publishAfter(`Moved to ${presentationName(presentationId)}:`);
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
        await ensureSetContent(id);
        const set = await db.sets.get(id);
        if (!set) continue;
        const merged = [...(set.tags ?? [])];
        for (const t of tags) if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
        await db.sets.update(id, { tags: merged, updatedAt: Date.now(), dirty: true });
      }
      setBulkTag("");
      await publishAfter("Tagged");
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
      <p className="admin-intro">Add, edit, move and delete sets for everyone. Changes publish straight away when the server can be reached.</p>
      {bankError && <p className="muted">{bankError}</p>}
      {message && <p role="status">{message}</p>}

      <SetAdditionUndo disabled={busy !== null || adding} onChanged={() => void refreshBank()} />
      <details className="section" open={summaries.length === 0}>
        <summary><h2>Add</h2></summary>
        <CreateTools embedded onSavingChange={setAdding} onSaved={() => void refreshBank()} />
      </details>

      <PeopleSection />

      <details className="section" open>
        <summary><h2>Sets</h2></summary>
        <div className="row" style={{ margin: "0.4rem 0 0.6rem" }}>
          <input type="search" aria-label="Filter sets" placeholder="Filter sets" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="small" onClick={() => setSort({ key: "added", direction: "desc" })}>Recently added</button>
          <span className="muted">{selected.size ? `${selected.size} selected` : `${rows.length} sets`}</span>
          <span style={{ flex: 1 }} />
          {selected.size > 0 ? (
            <>
              <input type="text" aria-label="Tag for selected sets" placeholder="Tag to add, e.g. Dizziness::Vestibular" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void tagSelected(); }} style={{ minWidth: "16rem" }} />
              <button className="small" onClick={tagSelected} disabled={busy !== null || !bulkTag.trim()}>Add tag</button>
              <PresentationSelect value="" onChange={moveSelected} disabled={busy !== null} placeholder="Move to presentation…" title="Each set takes the next number in that presentation" />
              <button className="small" onClick={publishSelected} disabled={busy !== null}>Publish selected</button>
              <button className="small danger" onClick={() => { setDeleteError(null); setPendingDelete([...selected]); }} disabled={busy !== null}>Delete selected</button>
              <button className="small link" onClick={() => setSelected(new Set())}>Clear</button>
            </>
          ) : (
            <button className="small" onClick={pushAll} disabled={busy !== null || !bank}>Publish local changes</button>
          )}
        </div>
        <div className="admin-table-scroll"><table className="admin-sets-table" aria-label="Admin question sets">
          <thead>
            <tr>
              <th style={{ width: "1.6rem" }}><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all shown" /></th>
              {heading("set", "Set")}{heading("questions", "Questions")}{heading("status", "Status")}{heading("added", "Added")}{heading("updated", "Updated")}<th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const entry = bankById.get(s.set.bankId ?? "");
              const status = !s.set.bankId ? "not published" : !bank ? "" : !entry ? "not found on the server" : s.set.dirty ? "edits not published" : "published";
              return (
                <tr key={s.set.id} className={selected.has(s.set.id) ? "selected" : ""}>
                  <td><input type="checkbox" aria-label={`Select ${fullLabel(s)}`} checked={selected.has(s.set.id)} onChange={() => toggle(s.set.id)} /></td>
                  <td>
                    <Link to={`/set/${s.set.id}`}>{fullLabel(s)}</Link>
                    <div className="muted">{[(s.set.tags ?? []).join(", "), s.set.source].filter(Boolean).join(", ")}</div>
                  </td>
                  <td>{s.questions.length}</td>
                  <td className="muted">{status}</td>
                  <td className="muted admin-date" title={addedAt(s) !== undefined ? new Date(addedAt(s)!).toLocaleString() : "Connect to the bank to see the original publish date"}>{addedAt(s) !== undefined ? formatDate(addedAt(s)!) : "—"}</td>
                  <td className="muted admin-date" title={new Date(updatedAt(s)).toLocaleString()}>{formatDate(updatedAt(s))}</td>
                  <td><div className="admin-set-actions">
                    <button className="small" onClick={() => nav(`/set/${s.set.id}/edit#case-stems`)}>Edit</button>
                    <button className="small danger" onClick={() => remove(s.set.id)} disabled={busy !== null}>Delete</button>
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {rows.length === 0 && summaries.length > 0 && <p className="muted">Nothing matches the filter.</p>}
      </details>
      {summaries.length === 0 && <p className="muted">No sets yet. Drop a folder or paste a paper above.</p>}

      <ConfirmDialog open={pendingDelete !== null} title={pendingTargets.length === 1 ? `Delete ${fullLabel(pendingTargets[0])}?` : `Delete ${pendingTargets.length} sets?`} confirmLabel={pendingTargets.length === 1 ? "Delete set" : `Delete ${pendingTargets.length} sets`} destructive busy={busy === "delete"} error={deleteError} onCancel={() => setPendingDelete(null)} onConfirm={() => { if (pendingDelete) void removeMany(pendingDelete); }}>
        <p>Removed from the shared library for everyone, with every attempt and mark on them on this device. This cannot be undone.</p>
        {pendingTargets.length > 1 && <ul>{pendingTargets.slice(0, 8).map((t) => <li key={t.set.id}>{fullLabel(t)}</li>)}{pendingTargets.length > 8 && <li>and {pendingTargets.length - 8} more</li>}</ul>}
      </ConfirmDialog>
    </div>
  );
}
