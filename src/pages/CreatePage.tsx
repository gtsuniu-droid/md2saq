import { primaryPresentation } from "../lib/primaryPresentation";
import SetAdditionUndo from "../components/SetAdditionUndo";
import { saveAddedSet, type AdditionAction } from "../lib/setAdditionUndo";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { db, newId } from "../data/db";
import type { Question, QuestionSet } from "../data/types";
import { parsePaper, questionFullText, type PaperMeta, type ParsedQuestion } from "../lib/parser";
import { suggestPresentations } from "../lib/suggest";
import PresentationPicker from "../components/PresentationPicker";
import { partLabel } from "../lib/questions";
import { presentationName } from "../data/presentations";
import { bankErrorMessage, pushToBank, savedPasscode } from "../lib/share";
import { readFileText } from "../lib/exportImport";
import PasscodeGate from "../components/PasscodeGate";
import { isAdmin } from "../lib/admin";
import { useLiveQuery } from "dexie-react-hooks";
import { getSettings } from "../data/db";
import { hasQuestionChunks, isCaseBank, parseAnswersOnly, parseCaseBank, type CaseFile, type ParsedCase } from "../lib/caseBank";
import { matchAnswers, mergeAnswersIntoSet, type AnswerMatch } from "../lib/mergeAnswers";
import { fullLabel } from "../lib/tree";
import { loadSummaries, nextSetNumber, setLabel } from "../lib/sets";
import { numberingGroup, setNumberLabel } from "../lib/setGroup";
import { knownTags, suggestConditionTags } from "../lib/tags";
import TagEditor from "../components/TagEditor";
import { FORMAT_GUIDE } from "../data/formatGuide";
import AutoTextarea from "../components/AutoTextarea";
import ModelAnswerEditor, { useModelAnswerImages } from "../components/ModelAnswerEditor";
import { mergeModelAnswers } from "../lib/modelAnswer";

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

interface CaseBatch {
  key: string;
  name: string;
  collection?: string;
  c: ParsedCase;
  drafts: Draft[];
  tags: string[];
}

/** Read every text file from a drop, descending into folders. */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const entries = [...dt.items].map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null));
  if (entries.some(Boolean)) {
    const walk = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
        if (/\.(txt|md|markdown)$/i.test(f.name) && !f.name.startsWith(".")) out.push(f);
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        let batch: FileSystemEntry[];
        do {
          batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e);
        } while (batch.length > 0);
      }
    };
    for (const e of entries) if (e) await walk(e);
    return out;
  }
  return [...dt.files].filter((f) => /\.(txt|md|markdown)$/i.test(f.name));
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

async function saveDrafts(name: string, source: string, drafts: Draft[], meta: PaperMeta = {}, extra: Partial<QuestionSet> = {}, action: AdditionAction = { id: newId(), label: "Added set" }): Promise<QuestionSet> {
  const number = await nextSetNumber(numberingGroup(extra.tags, drafts));
  const set: QuestionSet = {
    id: newId(),
    number,
    name: name.trim() || meta.title || setNumberLabel(number),
    source: source.trim() || undefined,
    suggestedMinutes: meta.minutes,
    createdAt: Date.now(),
    ...extra,
  };
  const questions: Question[] = drafts.map((d, i) => ({
    id: newId(),
    setId: set.id,
    order: i,
    stems: d.stems.length ? d.stems : undefined,
    text: d.text,
    marks: d.marks,
    modelAnswer: d.modelAnswer,
    modelAnswerDoc: d.modelAnswerDoc,
    parts: d.parts,
    presentations: d.presentations,
    tags: [],
    createdAt: Date.now(),
  }));
  set.primaryPresentation = primaryPresentation(set, questions);
  if (set.primaryPresentation && set.primaryPresentation !== numberingGroup(extra.tags, drafts)) set.number = await nextSetNumber(set.primaryPresentation);
  await saveAddedSet(set, questions, action);
  return set;
}

export default function CreatePage() {
  const settings = useLiveQuery(getSettings, []);
  if (!settings) return null;
  if (!isAdmin(settings)) return <p className="muted">Adding questions is limited to the site's admin account.</p>;
  return (
    <PasscodeGate title="Create" blurb="Adding questions needs the admin passcode. Enter it once on this device.">
      <CreateTools />
    </PasscodeGate>
  );
}

interface CreateToolsProps {
  /** Rendered inside the Master page: no heading. */
  embedded?: boolean;
  onSaved?: () => void;
  onSavingChange?: (saving: boolean) => void;
}

export function CreateTools({ embedded = false, onSaved, onSavingChange }: CreateToolsProps) {
  const [params] = useSearchParams();
  const presetPresentation = params.get("presentation") ?? "";
  const [raw, setRaw] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const known = useLiveQuery(async () => knownTags((await loadSummaries()).flatMap((s) => s.set.tags ?? [])), []) ?? [];
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const pasteSuggestions = useMemo(() => {
    const fromAnswers = suggestConditionTags(drafts);
    const top = drafts.flatMap((d) => d.presentations)[0];
    return top ? [presentationName(top), ...fromAnswers] : fromAnswers;
  }, [drafts]);
  const [meta, setMeta] = useState<PaperMeta>({});
  const [files, setFiles] = useState<FileBatch[]>([]);
  const [cases, setCases] = useState<CaseBatch[]>([]);
  const [merges, setMerges] = useState<AnswerMatch[]>([]);
  const summaries = useLiveQuery(loadSummaries, []) ?? [];
  const [setPresentations, setSetPresentations] = useState<string[]>(presetPresentation ? [presetPresentation] : []);
  const [saving, setSaving] = useState(false);
  useEffect(() => { onSavingChange?.(saving); }, [saving, onSavingChange]);
  const { addingImages, onBusyChange } = useModelAnswerImages();
  const [notice, setNotice] = useState<{ text: string; setId?: string; error?: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyGuide = async () => {
    try {
      await navigator.clipboard.writeText(FORMAT_GUIDE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy the guide:", FORMAT_GUIDE);
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-parse when the paste changes. Manual edits to drafts are kept until the paste changes again.
  // A paste holding whole cases ("CASE 01: ..." headers) is split into sets like a dropped file.
  useEffect(() => {
    const t = setTimeout(() => {
      const pasted: CaseFile[] = [{ name: "Pasted text", text: raw }];
      if (isCaseBank(pasted) && parseCaseBank(pasted).cases.some((c) => c.questions.length > 0)) {
        void addTexts(pasted);
        setRaw("");
        return;
      }
      const r = draftsFromText(raw, presetPresentation);
      setDrafts(r.drafts);
      setMeta(r.meta);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        ...mergeModelAnswers(prev, cur),
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

  /** Push a saved set to the bank when a passcode is on this device; report but do not block otherwise. */
  const pushOrReport = async (setId: string, label: string): Promise<boolean> => {
    if (!(await savedPasscode())) return true;
    try {
      await pushToBank(setId);
      return true;
    } catch (e) {
      setNotice({ text: `${label} saved on this device but not published: ${bankErrorMessage(e)}`, error: true });
      return false;
    }
  };

  const typedTags = (): string[] | undefined => (tags.length ? tags : undefined);

  const savePaste = async () => {
    if (drafts.length === 0 || addingImages || saving) return;
    setSaving(true); setNotice(null);
    try {
      const set = await saveDrafts(name, "", drafts, meta, { tags: typedTags() });
      const ok = await pushOrReport(set.id, setLabel(set));
      if (ok) setNotice({ text: `Saved ${setLabel(set)} with ${drafts.length} question${drafts.length === 1 ? "" : "s"}. Use Undo latest addition to reverse this.`, setId: set.id });
      setRaw(""); setDrafts([]); setTags([]);
      if (!presetPresentation) setName("");
    } catch (e) { setNotice({ text: `Could not save: ${bankErrorMessage(e)}`, error: true }); }
    finally { setSaving(false); onSaved?.(); }
  };

  const addFiles = async (list: FileList | File[]) => {
    const all = Array.from(list);
    const texts: CaseFile[] = [];
    for (const f of all) texts.push({ name: f.name, text: await readFileText(f) });
    await addTexts(texts, all);
  };

  /** Case-bank text (one file or many, questions and answers together or apart) becomes sets; anything else, one set per file. */
  const addTexts = async (texts: CaseFile[], all: File[] = []) => {
    if (isCaseBank(texts) && !hasQuestionChunks(texts)) {
      // Answers on their own: pair them with sets already in the library.
      const parsed = parseAnswersOnly(texts);
      const sets = await db.sets.toArray();
      setMerges((m) => [...m, ...matchAnswers(parsed, sets)]);
      return;
    }
    if (isCaseBank(texts)) {
      const bank = parseCaseBank(texts);
      setCases((cs) => [
        ...cs,
        ...bank.cases.map((c) => ({
          key: newId(),
          name: `Case ${String(c.number).padStart(2, "0")}`,
          collection: bank.collection,
          c,
          tags: c.conditions.length ? c.conditions : suggestConditionTags(c.questions),
          drafts: c.questions.map((q) => {
            // The bank and case titles say what the case is about; weight them above the stem's incidental symptoms.
            const heading = [bank.collection ?? "", c.title].join(" ");
            const suggested = suggestPresentations([heading, heading, heading, ...q.stems, questionFullText(q)].join("\n"));
            return { ...q, key: newId(), presentations: presetPresentation ? [presetPresentation] : suggested.slice(0, 1), suggested };
          }),
        })),
      ]);
      return;
    }
    const batches: FileBatch[] = [];
    for (const f of all) {
      const text = texts.find((t) => t.name === f.name)?.text ?? (await readFileText(f));
      const parsed = draftsFromText(text, presetPresentation);
      batches.push({ key: newId(), name: parsed.meta.title ?? f.name.replace(/\.[^.]+$/, ""), drafts: parsed.drafts, meta: parsed.meta });
    }
    setFiles((fs) => [...fs, ...batches]);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    await addFiles(await filesFromDrop(e.dataTransfer));
  };

  const applyMerges = async () => {
    const ready = merges.filter((m) => m.setId);
    if (ready.length === 0) return;
    setSaving(true);
    setNotice(null);
    let questions = 0;
    let ok = true;
    for (const m of ready) {
      questions += await mergeAnswersIntoSet(m.setId!, m.answers);
      if (ok) ok = await pushOrReport(m.setId!, `Answers for case ${m.answers.number}`);
    }
    if (ok) setNotice({ text: `Added answers to ${questions} question${questions === 1 ? "" : "s"} across ${ready.length} set${ready.length === 1 ? "" : "s"}.` });
    setMerges((ms) => ms.filter((m) => !m.setId));
    setSaving(false);
    onSaved?.();
  };

  const saveCases = async () => {
    if (cases.length === 0 || saving) return;
    setSaving(true); setNotice(null);
    const action = { id: newId(), label: "Imported cases" };
    let questions = 0;
    let ok = true;
    try {
      for (const b of cases) {
        const set = await saveDrafts("", `${b.name}: ${b.c.title}`, b.drafts, { minutes: b.c.minutes }, {
          collection: b.collection, tags: b.tags.length ? b.tags : undefined,
          instructions: b.c.instructions, markingNotes: b.c.markingNotes, debrief: b.c.debrief,
        }, action);
        questions += b.drafts.length;
        setCases((pending) => pending.filter((item) => item.key !== b.key));
        if (ok) ok = await pushOrReport(set.id, setLabel(set));
      }
      if (ok) setNotice({ text: `Saved ${cases.length} cases with ${questions} questions. Undo latest addition reverses this whole batch.` });
    } catch (e) { setNotice({ text: `Import stopped: ${bankErrorMessage(e)} Saved sets are in Recent additions; unsaved cases remain below.`, error: true }); }
    finally { setSaving(false); onSaved?.(); }
  };

  const saveFiles = async () => {
    const usable = files.filter((f) => f.drafts.length > 0);
    if (usable.length === 0 || saving) return;
    setSaving(true); setNotice(null);
    const action = { id: newId(), label: "Imported files" };
    let questions = 0;
    let ok = true;
    try {
      for (const f of usable) {
        const set = await saveDrafts(f.name, "", f.drafts, f.meta, { tags: typedTags() }, action);
        questions += f.drafts.length;
        setFiles((pending) => pending.filter((item) => item.key !== f.key));
        if (ok) ok = await pushOrReport(set.id, setLabel(set));
      }
      if (ok) setNotice({ text: `Saved ${usable.length} sets with ${questions} questions. Undo latest addition reverses this whole batch.` });
    } catch (e) { setNotice({ text: `Import stopped: ${bankErrorMessage(e)} Saved sets are in Recent additions; unsaved files remain below.`, error: true }); }
    finally { setSaving(false); onSaved?.(); }
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

  const fileQuestionCount = files.reduce((a, f) => a + f.drafts.length, 0);

  return (
    <div>
      {!embedded && <h1>Create</h1>}
      {!embedded && <SetAdditionUndo disabled={saving} onChanged={onSaved} />}
      {presetPresentation && (
        <p className="muted">Every question you add here is tagged <strong>{presentationName(presetPresentation)}</strong>. <Link to="/create">Clear</Link></p>
      )}
      {notice && (
        <p style={{ color: notice.error ? "var(--bad)" : "var(--ok)" }}>
          {notice.text}{notice.setId && <> <Link to={`/set/${notice.setId}`}>Open</Link></>}
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
            <strong>Drop files or a folder here.</strong> A generated case bank becomes one numbered set per case, tagged from its coverage file. An answers file on its own is merged into the matching sets. Other .txt or .md files become one set each.
          </span>
          <button className="small" onClick={() => fileRef.current?.click()}>Choose files</button>
          <input ref={fileRef} type="file" multiple accept=".md,.markdown,.txt,text/plain,text/markdown" style={{ display: "none" }}
            onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {merges.length > 0 && (
          <>
            <p className="muted" style={{ marginTop: "0.6rem" }}>Answer guides only. Each one is paired with a set already in the library; change the pairing if it guessed wrong.</p>
            <table>
              <thead><tr><th>Answers for</th><th>Goes into</th><th></th></tr></thead>
              <tbody>
                {merges.map((m, i) => (
                  <tr key={`${m.answers.number}-${i}`}>
                    <td>Case {String(m.answers.number).padStart(2, "0")}: {m.answers.title}<div className="muted">{m.answers.byQuestion.size} question{m.answers.byQuestion.size === 1 ? "" : "s"}{m.reason !== "none" ? `, matched by ${m.reason}` : ", no match"}</div></td>
                    <td>
                      <select value={m.setId ?? ""} onChange={(e) => setMerges((ms) => ms.map((x, xi) => (xi === i ? { ...x, setId: e.target.value || null } : x)))}>
                        <option value="">Choose a set</option>
                        {summaries.map((s) => <option key={s.set.id} value={s.set.id}>{fullLabel(s)}{s.set.source ? ` — ${s.set.source}` : ""}</option>)}
                      </select>
                    </td>
                    <td><button className="small danger" onClick={() => setMerges((ms) => ms.filter((_, xi) => xi !== i))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: "0.6rem" }}>
              <button className="primary" onClick={applyMerges} disabled={saving || !merges.some((m) => m.setId)}>Add answers to {merges.filter((m) => m.setId).length} set{merges.filter((m) => m.setId).length === 1 ? "" : "s"}</button>
            </div>
          </>
        )}
        {cases.length > 0 && (
          <>
            <table style={{ marginTop: "0.6rem" }}>
              <thead><tr><th>Set</th><th>Case</th><th>Questions</th><th>Marks</th><th>Answers</th><th>Tags</th><th></th></tr></thead>
              <tbody>
                {cases.map((b) => (
                  <tr key={b.key}>
                    <td><input type="text" value={b.name} style={{ width: "6rem" }} onChange={(e) => setCases((cs) => cs.map((x) => (x.key === b.key ? { ...x, name: e.target.value } : x)))} /></td>
                    <td>{b.c.title}</td>
                    <td>{b.drafts.length}</td>
                    <td>{(b.c.marks ?? b.drafts.reduce((a, d) => a + (d.marks ?? 0), 0)) || "—"}</td>
                    <td className="muted">{b.c.hasAnswers ? "yes" : "no"}</td>
                    <td style={{ minWidth: "16rem" }}>
                      <TagEditor value={b.tags} known={known} compact
                        onChange={(t) => setCases((cs) => cs.map((x) => (x.key === b.key ? { ...x, tags: t } : x)))} />
                    </td>
                    <td><button className="small danger" onClick={() => setCases((cs) => cs.filter((x) => x.key !== b.key))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: "0.6rem" }}>
              <button className="primary" onClick={saveCases} disabled={saving}>Save {cases.length} case{cases.length === 1 ? "" : "s"}</button>
            </div>
          </>
        )}
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
              <div style={{ flex: 1 }}><TagEditor value={tags} onChange={setTags} known={known} suggestions={suggestConditionTags(files.flatMap((f) => f.drafts))} compact /></div>
              <button className="primary" onClick={saveFiles} disabled={saving || fileQuestionCount === 0}>Save {files.filter((f) => f.drafts.length).length} sets ({fileQuestionCount} questions)</button>
            </div>
          </>
        )}
      </div>

      <details className="guide" style={{ margin: "0.8rem 0" }}>
        <summary style={{ cursor: "pointer" }}>
          <span>Format guide for question generators</span>
          <button className="small" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copyGuide(); }}>{copied ? "Copied" : "Copy guide"}</button>
        </summary>
        <pre className="guide-text" onClick={() => void copyGuide()} title="Click to copy">{FORMAT_GUIDE}</pre>
      </details>
      <p className="muted">
        Or paste below. Formats: numbered (1. / Q1 / Question 1), blank-line separated, sub-parts as (a) or 1),
        marks as (4 marks) or [4], and model answers after a line starting with "Answer:" or "Model answer:".
      </p>
      <AutoTextarea value={raw} disabled={addingImages} onChange={(e) => setRaw(e.target.value)} placeholder="Paste here" style={{ minHeight: "12rem" }} />

      {drafts.length > 0 && (
        <>
          <div className="row" style={{ marginTop: "1rem" }}>
            <input type="text" placeholder={meta.title ?? "Title (optional)"} value={name} onChange={(e) => setName(e.target.value)} />

            <span className="muted">{drafts.length} questions{totalMarks ? `, ${totalMarks} marks` : ""}{meta.minutes ? `, ${meta.minutes} min suggested` : ""}</span>
          </div>
          <div style={{ marginTop: "0.6rem" }}>
            <label>Tags</label>
            <TagEditor value={tags} onChange={setTags} suggestions={pasteSuggestions} known={known} />
          </div>
          <div className="row" style={{ marginTop: "0.6rem" }}>
            <button className="primary" onClick={savePaste} disabled={saving || addingImages}>{addingImages ? "Adding pictures…" : `Save ${drafts.length} question${drafts.length === 1 ? "" : "s"}`}</button>
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
                    {i > 0 && <button className="small" disabled={addingImages} onClick={() => mergeUp(d.key)} title="Join to the previous question">Merge ↑</button>}
                    <button className="small danger" disabled={addingImages} onClick={() => remove(d.key)}>Remove</button>
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
                        <AutoTextarea value={st} placeholder="Case information the candidate reads before this question" onChange={(e) => updateStem(d.key, si, e.target.value)} style={{ minHeight: "4rem" }} />
                      )}
                    </div>
                  );
                })}
                <div className="row" style={{ marginTop: "0.5rem" }}>
                  <button className="small" onClick={() => addStem(d.key)} title="Adds a stem here and to every later question">+ Add stem</button>
                </div>
                <label>Question</label>
                <AutoTextarea value={d.text} onChange={(e) => update(d.key, { text: e.target.value })} style={{ minHeight: "4rem" }} />
                {d.parts.map((p, pi) => (
                  <div key={pi} className="card" style={{ marginTop: "0.6rem" }}>
                    <div className="row" style={{ alignItems: "flex-start" }}>
                    <span style={{ minWidth: "2.2rem", fontWeight: 600 }}>{partLabel(p.label)}</span>
                    <AutoTextarea
                      value={p.text}
                      style={{ minHeight: "2.4rem", flex: 1 }}
                      onChange={(e) => update(d.key, { parts: d.parts.map((x, xi) => (xi === pi ? { ...x, text: e.target.value } : x)) })}
                    />
                    <input type="number" min={0} placeholder="marks" value={p.marks ?? ""}
                      onChange={(e) => update(d.key, { parts: d.parts.map((x, xi) => (xi === pi ? { ...x, marks: e.target.value === "" ? undefined : Number(e.target.value) } : x)) })} />
                    </div>
                    <label>Model answer for this part</label>
                    <ModelAnswerEditor answer={p} label={`Model answer for question ${i + 1}, part ${p.label}`} onChange={(value) => update(d.key, { parts: d.parts.map((x, xi) => xi === pi ? { ...x, ...value } : x) })} onBusyChange={(value) => onBusyChange(`${d.key}:part:${pi}`, value)} />
                  </div>
                ))}
                <label>Model answer (optional, one marking point per line)</label>
                <ModelAnswerEditor answer={d} label={`Model answer for question ${i + 1}`} onChange={(value) => update(d.key, value)} onBusyChange={(value) => onBusyChange(`${d.key}:whole`, value)} />
                <label>Presentations</label>
                <PresentationPicker selected={d.presentations} suggested={d.suggested} onChange={(ids) => update(d.key, { presentations: ids })} />
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: "1rem" }}>
            <button className="primary" onClick={savePaste} disabled={saving || addingImages}>{addingImages ? "Adding pictures…" : `Save ${drafts.length} question${drafts.length === 1 ? "" : "s"}`}</button>
          </div>
        </>
      )}
    </div>
  );
}
