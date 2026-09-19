import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { db, newId } from "../data/db";
import type { Question, QuestionSet } from "../data/types";
import { parsePaper, questionFullText, type PaperMeta, type ParsedQuestion } from "../lib/parser";
import { suggestPresentations } from "../lib/suggest";
import PresentationPicker from "../components/PresentationPicker";
import { partLabel } from "../lib/questions";
import { presentationName } from "../data/presentations";
import { PasscodeError, forgetPasscode, savedPasscode, shareSet } from "../lib/share";
import { readFileText } from "../lib/exportImport";
import PasscodeGate from "../components/PasscodeGate";

interface Draft extends ParsedQuestion {
  key: string;
  presentations: string[];
  suggested: string[];
}

interface FileBatch {
  key: string;
  name: string;
  drafts: Draft[];
  meta: PaperMeta;
}

function draftsFromText(text: string, preset: string): { drafts: Draft[]; meta: PaperMeta } {
  const { questions, meta } = parsePaper(text);
  const drafts = questions.map((q) => {
    const suggested = suggestPresentations([...q.stems, questionFullText(q)].join("\n"));
    const presentations = preset ? [preset] : suggested.slice(0, 1);
    return { ...q, key: newId(), presentations, suggested };
  });
  return { drafts, meta };
}

async function saveDrafts(name: string, source: string, drafts: Draft[], meta: PaperMeta = {}): Promise<QuestionSet> {
  const set: QuestionSet = {
    id: newId(),
    name: name.trim() || meta.title || `Set ${new Date().toLocaleDateString()}`,
    source: source.trim() || undefined,
    suggestedMinutes: meta.minutes,
    createdAt: Date.now(),
  };
  const questions: Question[] = drafts.map((d, i) => ({
    id: newId(),
    setId: set.id,
    order: i,
    stems: d.stems.length ? d.stems : undefined,
    text: d.text,
    marks: d.marks,
    modelAnswer: d.modelAnswer,
    parts: d.parts,
    presentations: d.presentations,
    tags: [],
    createdAt: Date.now(),
  }));
  await db.transaction("rw", db.sets, db.questions, async () => {
    await db.sets.add(set);
    await db.questions.bulkAdd(questions);
  });
  return set;
}

export default function CreatePage() {
  return (
    <PasscodeGate title="Create" blurb="Creator tools are locked behind the bank passcode. Enter it once on this device.">
      <CreateTools />
    </PasscodeGate>
  );
}

function CreateTools() {
  const [params] = useSearchParams();
  const presetPresentation = params.get("presentation") ?? "";
  const [raw, setRaw] = useState("");
  const [name, setName] = useState(presetPresentation ? `${presentationName(presetPresentation)} set` : "");
  const [source, setSource] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [meta, setMeta] = useState<PaperMeta>({});
  const [files, setFiles] = useState<FileBatch[]>([]);
  const [setPresentations, setSetPresentations] = useState<string[]>(presetPresentation ? [presetPresentation] : []);
  const [saving, setSaving] = useState(false);
  const [askPasscode, setAskPasscode] = useState<null | "paste" | "files">(null);
  const [passcode, setPasscode] = useState("");
  const [notice, setNotice] = useState<{ text: string; setId?: string; error?: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-parse when the paste changes. Manual edits to drafts are kept until the paste changes again.
  useEffect(() => {
    const t = setTimeout(() => {
      const r = draftsFromText(raw, presetPresentation);
      setDrafts(r.drafts);
      setMeta(r.meta);
    }, 250);
    return () => clearTimeout(t);
  }, [raw, presetPresentation]);

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const remove = (key: string) => setDrafts((ds) => ds.filter((d) => d.key !== key));
  const mergeUp = (key: string) =>
    setDrafts((ds) => {
      const i = ds.findIndex((d) => d.key === key);
      if (i <= 0) return ds;
      const prev = ds[i - 1];
      const cur = ds[i];
      const merged: Draft = {
        ...prev,
        text: [prev.text, cur.text].filter(Boolean).join("\n"),
        parts: [...prev.parts, ...cur.parts],
        marks: prev.marks !== undefined || cur.marks !== undefined ? (prev.marks ?? 0) + (cur.marks ?? 0) : undefined,
        modelAnswer: [prev.modelAnswer, cur.modelAnswer].filter(Boolean).join("\n") || undefined,
        presentations: [...new Set([...prev.presentations, ...cur.presentations])],
      };
      return [...ds.slice(0, i - 1), merged, ...ds.slice(i + 1)];
    });

  /** Add an empty stem to this question and every later one (stages accumulate). */
  const addStem = (key: string) =>
    setDrafts((ds) => {
      const i = ds.findIndex((d) => d.key === key);
      return ds.map((d, j) => (j >= i ? { ...d, stems: [...d.stems, ""] } : d));
    });
  const updateStem = (key: string, si: number, text: string) =>
    setDrafts((ds) => {
      const i = ds.findIndex((d) => d.key === key);
      const old = ds[i].stems[si];
      // Keep later questions that share this stem in sync.
      return ds.map((d, j) => (j >= i && d.stems[si] === old ? { ...d, stems: d.stems.map((x, xi) => (xi === si ? text : x)) } : d));
    });
  const removeStem = (key: string, si: number) =>
    setDrafts((ds) => {
      const i = ds.findIndex((d) => d.key === key);
      const old = ds[i].stems[si];
      return ds.map((d, j) => (j >= i && d.stems[si] === old ? { ...d, stems: d.stems.filter((_, xi) => xi !== si) } : d));
    });

  const applySetPresentations = () =>
    setDrafts((ds) => ds.map((d) => ({ ...d, presentations: [...new Set([...d.presentations, ...setPresentations])] })));

  const totalMarks = useMemo(() => drafts.reduce((acc, d) => acc + (d.marks ?? 0), 0), [drafts]);

  /** Resolve a passcode for sharing, or open the prompt and return null. */
  const passcodeFor = async (which: "paste" | "files"): Promise<string | null> => {
    const code = passcode || (await savedPasscode());
    if (code) return code;
    setAskPasscode(which);
    return null;
  };

  const shareOrReport = async (setId: string, code: string, label: string): Promise<boolean> => {
    try {
      await shareSet(setId, code);
      return true;
    } catch (e) {
      if (e instanceof PasscodeError) {
        await forgetPasscode();
        setPasscode("");
        setNotice({ text: `${label} saved locally, but the passcode was wrong. Share it from Browse once you have the right one.`, error: true });
      } else {
        setNotice({ text: `${label} saved locally, but sharing failed: ${e instanceof Error ? e.message : String(e)}`, error: true });
      }
      return false;
    }
  };

  const savePaste = async (share: boolean) => {
    if (drafts.length === 0) return;
    const code = share ? await passcodeFor("paste") : "";
    if (share && !code) return;
    setSaving(true);
    setNotice(null);
    const set = await saveDrafts(name, source, drafts, meta);
    let shared = true;
    if (share) shared = await shareOrReport(set.id, code!, `"${set.name}"`);
    if (shared) setNotice({ text: `Saved "${set.name}" with ${drafts.length} questions${share ? " and shared it to the bank" : ""}.`, setId: set.id });
    setRaw("");
    setDrafts([]);
    if (!presetPresentation) setName("");
    setAskPasscode(null);
    setSaving(false);
  };

  const addFiles = async (list: FileList | File[]) => {
    const batches: FileBatch[] = [];
    for (const f of Array.from(list)) {
      const text = await readFileText(f);
      const parsed = draftsFromText(text, presetPresentation);
      batches.push({ key: newId(), name: parsed.meta.title ?? f.name.replace(/\.[^.]+$/, ""), drafts: parsed.drafts, meta: parsed.meta });
    }
    setFiles((fs) => [...fs, ...batches]);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    await addFiles(e.dataTransfer.files);
  };

  const saveFiles = async (share: boolean) => {
    const usable = files.filter((f) => f.drafts.length > 0);
    if (usable.length === 0) return;
    const code = share ? await passcodeFor("files") : "";
    if (share && !code) return;
    setSaving(true);
    setNotice(null);
    let sets = 0;
    let questions = 0;
    let sharedAll = true;
    for (const f of usable) {
      const set = await saveDrafts(f.name, source, f.drafts, f.meta);
      sets++;
      questions += f.drafts.length;
      if (share && sharedAll) sharedAll = await shareOrReport(set.id, code!, `"${set.name}"`);
    }
    if (!share || sharedAll) {
      setNotice({ text: `Saved ${sets} set${sets === 1 ? "" : "s"} with ${questions} questions${share ? " and shared them to the bank" : ""}.` });
    }
    setFiles([]);
    setAskPasscode(null);
    setSaving(false);
  };

  const editFile = (f: FileBatch) => {
    // Rebuild a pasteable text from the parsed questions so it can be reviewed in the preview.
    let shown = 0;
    const text = f.drafts
      .map((d, i) => {
        const stages = d.stems.slice(shown).map((st, k) => `Stage ${shown + k + 1}\n${st}`);
        shown = Math.max(shown, d.stems.length);
        const head = `${stages.length ? stages.join("\n\n") + "\n\n" : ""}Question ${i + 1}. ${d.text}${d.marks !== undefined && d.parts.length === 0 ? ` (${d.marks} marks)` : ""}`;
        const parts = d.parts.map((p) => `${partLabel(p.label)} ${p.text}${p.marks !== undefined ? ` (${p.marks} marks)` : ""}`);
        const answer = d.modelAnswer ? [`Answer:`, d.modelAnswer] : [];
        return [head, ...parts, ...answer].join("\n");
      })
      .join("\n\n");
    setRaw(text);
    setName(f.name);
    setFiles((fs) => fs.filter((x) => x.key !== f.key));
    window.scrollTo({ top: 0 });
  };

  const passcodePrompt = (which: "paste" | "files") =>
    askPasscode === which ? (
      <>
        <input type="password" placeholder="Bank passcode" value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && passcode) void (which === "paste" ? savePaste(true) : saveFiles(true)); }} />
        <button onClick={() => (which === "paste" ? savePaste(true) : saveFiles(true))} disabled={saving || !passcode}>Save and share</button>
        <button onClick={() => setAskPasscode(null)}>Cancel</button>
      </>
    ) : null;

  const fileQuestionCount = files.reduce((a, f) => a + f.drafts.length, 0);

  return (
    <div>
      <h1>Create</h1>
      {presetPresentation && (
        <p className="muted">Every question you add here is tagged <strong>{presentationName(presetPresentation)}</strong>. <Link to="/create">Clear</Link></p>
      )}
      {notice && (
        <p style={{ color: notice.error ? "var(--bad)" : "var(--ok)" }}>
          {notice.text}{notice.setId && <> <Link to={`/browse?set=${notice.setId}`}>View</Link></>}
        </p>
      )}

      <div
        className="card"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{ borderStyle: "dashed", borderColor: dragging ? "var(--accent)" : "var(--border)", marginBottom: "0.8rem" }}
      >
        <div className="row spread">
          <span>
            <strong>Many at once:</strong> drop .md or .txt files here, one set per file, named after the file.
          </span>
          <button className="small" onClick={() => fileRef.current?.click()}>Choose files</button>
          <input ref={fileRef} type="file" multiple accept=".md,.markdown,.txt,text/plain,text/markdown" style={{ display: "none" }}
            onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {files.length > 0 && (
          <>
            <table style={{ marginTop: "0.6rem" }}>
              <thead><tr><th>Set name</th><th>Questions</th><th>Marks</th><th></th></tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.key}>
                    <td><input type="text" value={f.name} style={{ width: "100%" }} onChange={(e) => setFiles((fs) => fs.map((x) => (x.key === f.key ? { ...x, name: e.target.value } : x)))} /></td>
                    <td>{f.drafts.length === 0 ? <span style={{ color: "var(--bad)" }}>none parsed</span> : f.drafts.length}</td>
                    <td>{f.drafts.reduce((a, d) => a + (d.marks ?? 0), 0) || "—"}</td>
                    <td className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="small" onClick={() => editFile(f)} disabled={f.drafts.length === 0}>Review</button>
                      <button className="small danger" onClick={() => setFiles((fs) => fs.filter((x) => x.key !== f.key))}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: "0.6rem" }}>
              <button className="primary" onClick={() => saveFiles(false)} disabled={saving || fileQuestionCount === 0}>Save {files.filter((f) => f.drafts.length).length} sets ({fileQuestionCount} questions)</button>
              {askPasscode === "files" ? passcodePrompt("files") : (
                <button onClick={() => saveFiles(true)} disabled={saving || fileQuestionCount === 0}>Save and share all</button>
              )}
            </div>
          </>
        )}
      </div>

      <p className="muted">
        Or paste below. Formats: numbered (1. / Q1 / Question 1), blank-line separated, sub-parts as (a) or 1),
        marks as (4 marks) or [4], and model answers after a line starting with "Answer:" or "Model answer:".
      </p>
      <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Paste here" style={{ minHeight: "12rem" }} />

      {drafts.length > 0 && (
        <>
          <div className="row" style={{ marginTop: "1rem" }}>
            <input type="text" placeholder={meta.title ?? "Set name"} value={name} onChange={(e) => setName(e.target.value)} />
            <input type="text" placeholder="Source (optional)" value={source} onChange={(e) => setSource(e.target.value)} />
            <span className="muted">{drafts.length} questions{totalMarks ? `, ${totalMarks} marks` : ""}{meta.minutes ? `, ${meta.minutes} min suggested` : ""}</span>
          </div>
          <div className="row" style={{ marginTop: "0.6rem" }}>
            <button className="primary" onClick={() => savePaste(false)} disabled={saving}>Save {drafts.length} questions</button>
            {askPasscode === "paste" ? passcodePrompt("paste") : (
              <button onClick={() => savePaste(true)} disabled={saving}>Save and share to bank</button>
            )}
          </div>
          <div className="card" style={{ marginTop: "0.8rem" }}>
            <div className="row spread">
              <div style={{ flex: 1 }}>
                <span className="muted">Tag every question in this set with:</span>
                <PresentationPicker selected={setPresentations} onChange={setSetPresentations} />
              </div>
              <button className="small" onClick={applySetPresentations} disabled={setPresentations.length === 0}>Apply to all</button>
            </div>
          </div>

          <div className="stack" style={{ marginTop: "1rem" }}>
            {drafts.map((d, i) => (
              <div key={d.key} className="card">
                <div className="row spread">
                  <strong>Question {i + 1}{d.number !== undefined && d.number !== i + 1 ? ` (was ${d.number})` : ""}</strong>
                  <span className="row">
                    <label style={{ margin: 0 }}>Marks</label>
                    <input type="number" min={0} value={d.marks ?? ""} onChange={(e) => update(d.key, { marks: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    {i > 0 && <button className="small" onClick={() => mergeUp(d.key)} title="Join to the previous question">Merge ↑</button>}
                    <button className="small danger" onClick={() => remove(d.key)}>Remove</button>
                  </span>
                </div>
                {d.stems.map((st, si) => {
                  const inherited = i > 0 && drafts[i - 1].stems[si] === st;
                  return (
                    <div key={si} style={{ marginTop: "0.5rem" }}>
                      <div className="row spread">
                        <span className="muted">Stem {si + 1}{inherited ? " (shared with the question above)" : ""}</span>
                        <button className="small danger" onClick={() => removeStem(d.key, si)}>Remove stem</button>
                      </div>
                      {inherited ? (
                        <div className="muted pre" style={{ fontSize: "0.85rem", maxHeight: "4.5rem", overflow: "hidden" }}>{st}</div>
                      ) : (
                        <textarea value={st} placeholder="Case information the candidate reads before this question" onChange={(e) => updateStem(d.key, si, e.target.value)} style={{ minHeight: "4rem" }} />
                      )}
                    </div>
                  );
                })}
                <div className="row" style={{ marginTop: "0.5rem" }}>
                  <button className="small" onClick={() => addStem(d.key)} title="Adds a stem here and to every later question">+ Add stem</button>
                </div>
                <label>Question</label>
                <textarea value={d.text} onChange={(e) => update(d.key, { text: e.target.value })} style={{ minHeight: "4rem" }} />
                {d.parts.map((p, pi) => (
                  <div key={pi} className="row" style={{ marginTop: "0.3rem", alignItems: "flex-start" }}>
                    <span style={{ minWidth: "2.2rem", fontWeight: 600 }}>{partLabel(p.label)}</span>
                    <textarea
                      value={p.text}
                      style={{ minHeight: "2.4rem", flex: 1 }}
                      onChange={(e) => update(d.key, { parts: d.parts.map((x, xi) => (xi === pi ? { ...x, text: e.target.value } : x)) })}
                    />
                    <input type="number" min={0} placeholder="marks" value={p.marks ?? ""}
                      onChange={(e) => update(d.key, { parts: d.parts.map((x, xi) => (xi === pi ? { ...x, marks: e.target.value === "" ? undefined : Number(e.target.value) } : x)) })} />
                  </div>
                ))}
                <label>Model answer (optional, one marking point per line)</label>
                <textarea value={d.modelAnswer ?? ""} onChange={(e) => update(d.key, { modelAnswer: e.target.value || undefined })} style={{ minHeight: "3rem" }} />
                <label>Presentations</label>
                <PresentationPicker selected={d.presentations} suggested={d.suggested} onChange={(ids) => update(d.key, { presentations: ids })} />
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: "1rem" }}>
            <button className="primary" onClick={() => savePaste(false)} disabled={saving}>Save {drafts.length} questions</button>
            {askPasscode !== "paste" && <button onClick={() => savePaste(true)} disabled={saving}>Save and share to bank</button>}
          </div>
        </>
      )}
    </div>
  );
}
