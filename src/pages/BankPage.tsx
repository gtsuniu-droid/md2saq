import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { db } from "../data/db";
import { presentationName } from "../data/presentations";
import { BankPasscodeError, fetchBankSet, listBank, type BankEntry } from "../lib/bank";
import { importSetPack, type SetPack } from "../lib/exportImport";
import { formatDate, partLabel, totalMarks, truncate } from "../lib/questions";
import ShareSetButton from "../components/ShareSetButton";

export default function BankPage() {
  const nav = useNavigate();
  const settings = useLiveQuery(() => db.settings.get("settings"), []);
  const local = useLiveQuery(() => db.sets.orderBy("createdAt").reverse().toArray(), []);
  const saved = settings?.bankPasscode ?? "";

  const [entries, setEntries] = useState<BankEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [passcode, setPasscode] = useState("");
  const [packs, setPacks] = useState<Record<string, SetPack | undefined>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = async (code: string) => {
    setError(null);
    setBusy("list");
    try {
      const list = await listBank(code);
      setEntries(list);
      if (code !== saved) await db.settings.update("settings", { bankPasscode: code });
    } catch (e) {
      setEntries(null);
      if (e instanceof BankPasscodeError) {
        await db.settings.update("settings", { bankPasscode: undefined });
        setError("Wrong passcode.");
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
      nav(`/browse?set=${setId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const importedIds = new Set((local ?? []).map((s) => s.bankId).filter(Boolean));
  const unshared = (local ?? []).filter((s) => !s.bankId);

  if (settings === undefined) return null;

  if (!saved) {
    return (
      <div>
        <h1>Shared bank</h1>
        <p className="muted">Enter the bank passcode to browse every shared question set, import them, and share your own.</p>
        <div className="row">
          <input type="password" placeholder="Bank passcode" value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && passcode) void load(passcode); }} />
          <button className="primary" disabled={!passcode || busy !== null} onClick={() => load(passcode)}>Open bank</button>
        </div>
        {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
      </div>
    );
  }

  const totalQuestions = (entries ?? []).reduce((a, e) => a + e.questionCount, 0);

  return (
    <div>
      <div className="row spread">
        <h1 style={{ margin: 0 }}>Shared bank</h1>
        <span className="muted">{entries ? `${entries.length} sets · ${totalQuestions} questions` : ""}</span>
      </div>
      <p className="muted">New sets are imported into your library automatically when the app opens. Your answers stay on your device.</p>
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
                  <td>{e.name}{e.source && <div className="muted">{e.source}</div>}</td>
                  <td>{e.questionCount}</td>
                  <td>{e.presentations.slice(0, 4).map((p) => <span key={p} className="chip static">{presentationName(p)}</span>)}{e.presentations.length > 4 ? <span className="muted">+{e.presentations.length - 4}</span> : null}</td>
                  <td>{formatDate(e.uploadedAt)}</td>
                  <td className="row" style={{ justifyContent: "flex-end" }}>
                    <button className="small" onClick={() => toggleQuestions(e.id)}>{expanded ? "Hide" : "Questions"}</button>
                    <button className="small" onClick={() => importEntry(e)} disabled={busy !== null}>
                      {importedIds.has(e.id) ? "Import again" : "Import"}
                    </button>
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
                              {q.parts.length > 0 && <span className="muted"> · {q.parts.map((p) => partLabel(p.label)).join(" ")}</span>}
                              {totalMarks(q) !== undefined && <span className="muted"> · {totalMarks(q)} marks</span>}
                              {(q.modelAnswer || q.parts.some((p) => p.modelAnswer)) && <span className="muted"> · model answer</span>}
                              {q.presentations.map((p) => <span key={p} className="chip static" style={{ marginLeft: "0.3rem" }}>{presentationName(p)}</span>)}
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
