import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { db, getSettings, patchSettings } from "../data/db";
import { presentationName } from "../data/presentations";
import { BankPasscodeError, deleteBankSet, fetchBankSet, listBank, type BankEntry } from "../lib/bank";
import { importSetPack, type SetPack } from "../lib/exportImport";
import { formatDate, partLabel, totalMarks, truncate } from "../lib/questions";
import ShareSetButton from "../components/ShareSetButton";
import PasscodeGate from "../components/PasscodeGate";

export default function BankPage() {
  return (
    <PasscodeGate title="Shared bank" blurb="Enter the bank passcode to browse every shared question set, import them, and share your own.">
      <BankContents />
    </PasscodeGate>
  );
}

function BankContents() {
  const nav = useNavigate();
  const settings = useLiveQuery(getSettings, []);
  const local = useLiveQuery(() => db.sets.orderBy("createdAt").reverse().toArray(), []);
  const saved = settings?.bankPasscode ?? "";

  const [entries, setEntries] = useState<BankEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [packs, setPacks] = useState<Record<string, SetPack | undefined>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = async (code: string) => {
    setError(null);
    setBusy("list");
    try {
      const list = await listBank(code);
      setEntries(list);
      if (code !== saved) await patchSettings({ bankPasscode: code });
    } catch (e) {
      setEntries(null);
      if (e instanceof BankPasscodeError) {
        await patchSettings({ bankPasscode: undefined });
      } else {
        setError("The shared bank is not reachable. It only works on the deployed Netlify site.");
      }
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (settings === undefined) return;
    if (saved && entries === null && !error) void load(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const toggleQuestions = async (id: string) => {
    const next = new Set(open);
    if (next.has(id)) {
      next.delete(id);
      setOpen(next);
      return;
    }
    next.add(id);
    setOpen(next);
    if (!packs[id]) {
      try {
        const pack = await fetchBankSet(id, saved);
        setPacks((p) => ({ ...p, [id]: pack }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const importEntry = async (entry: BankEntry) => {
    setBusy(entry.id);
    try {
      const pack = packs[entry.id] ?? (await fetchBankSet(entry.id, saved));
      const setId = await importSetPack(pack, entry.id);
      nav(`/set/${setId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const importedIds = new Set((local ?? []).map((s) => s.bankId).filter(Boolean));
  const localFor = (bankId: string) => (local ?? []).find((s) => s.bankId === bankId);

  /** Edit a bank set: open the local copy's editor, importing first if needed. */
  const editEntry = async (entry: BankEntry) => {
    const mine = localFor(entry.id);
    if (mine) {
      nav(`/set/${mine.id}/edit`);
      return;
    }
    setBusy(entry.id);
    try {
      const pack = packs[entry.id] ?? (await fetchBankSet(entry.id, saved));
      const setId = await importSetPack(pack, entry.id, entry.updatedAt ?? entry.uploadedAt);
      nav(`/set/${setId}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const removeEntry = async (entry: BankEntry) => {
    if (!confirm(`Remove "${entry.name}" from the shared bank for everyone? Local copies are kept.`)) return;
    setBusy(entry.id);
    try {
      await deleteBankSet(entry.id, saved);
      const mine = localFor(entry.id);
      if (mine) await db.sets.update(mine.id, { bankId: undefined, bankUpdatedAt: undefined });
      setEntries((es) => (es ?? []).filter((e) => e.id !== entry.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const unshared = (local ?? []).filter((s) => !s.bankId);

  if (settings === undefined) return null;

  const totalQuestions = (entries ?? []).reduce((a, e) => a + e.questionCount, 0);

  return (
    <div>
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Shared bank</h1>
        <span className="muted">{entries ? `${entries.length} sets, ${totalQuestions} questions` : ""}</span>
      </div>
      <p className="muted">New and edited sets reach every library automatically when the app opens. Edit opens the set in your library and lets you push the changes back. Your answers stay on your device.</p>
      {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
      {entries && entries.length === 0 && <p className="muted">Nothing shared yet.</p>}
      {entries && entries.length > 0 && (
        <table>
          <thead><tr><th>Set</th><th>Questions</th><th>Presentations</th><th>Shared</th><th></th></tr></thead>
          <tbody>
            {entries.map((e) => {
              const pack = packs[e.id];
              const expanded = open.has(e.id);
              return [
                <tr key={e.id}>
                  <td>{e.name}<div className="muted">{[e.collection, (e.tags ?? []).slice(0, 3).join(", "), e.source].filter(Boolean).join(", ")}</div></td>
                  <td>{e.questionCount}</td>
                  <td className="muted">{e.presentations.slice(0, 4).map(presentationName).join(", ")}{e.presentations.length > 4 ? ` +${e.presentations.length - 4}` : ""}</td>
                  <td>{formatDate(e.uploadedAt)}</td>
                  <td className="row" style={{ justifyContent: "flex-end" }}>
                    <button className="small" onClick={() => toggleQuestions(e.id)}>{expanded ? "Hide" : "Questions"}</button>
                    <button className="small" onClick={() => importEntry(e)} disabled={busy !== null}>
                      {importedIds.has(e.id) ? "Import again" : "Import"}
                    </button>
                    <button className="small" onClick={() => editEntry(e)} disabled={busy !== null}>Edit</button>
                    <button className="small danger" onClick={() => removeEntry(e)} disabled={busy !== null}>Remove</button>
                  </td>
                </tr>,
                expanded ? (
                  <tr key={e.id + "-q"}>
                    <td colSpan={5} style={{ background: "var(--sidebar)" }}>
                      {!pack && <span className="muted">Loading…</span>}
                      {pack && (
                        <ol style={{ margin: 0, paddingLeft: "1.4rem" }}>
                          {pack.questions.map((q) => (
                            <li key={q.id} style={{ margin: "0.3rem 0" }}>
                              {truncate(q.text || q.parts[0]?.text || "", 220)}
                              {q.parts.length > 0 && <span className="muted">, {q.parts.map((p) => partLabel(p.label)).join(" ")}</span>}
                              {totalMarks(q) !== undefined && <span className="muted">, {totalMarks(q)} marks</span>}
                              {(q.modelAnswer || q.parts.some((p) => p.modelAnswer)) && <span className="muted">, model answer</span>}
                              {q.presentations.length > 0 && <span className="muted">, {q.presentations.map(presentationName).join(", ")}</span>}
                            </li>
                          ))}
                        </ol>
                      )}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      )}

      <h2>Share one of your sets</h2>
      {unshared.length === 0 && <p className="muted">Every set in your library is already shared.</p>}
      <table>
        <tbody>
          {unshared.map((s) => (
            <tr key={s.id}>
              <td>{s.name}{s.source && <div className="muted">{s.source}</div>}</td>
              <td style={{ textAlign: "right" }}><ShareSetButton setId={s.id} className="small" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Questions only are shared, never your answers or marks.</p>
    </div>
  );
}
