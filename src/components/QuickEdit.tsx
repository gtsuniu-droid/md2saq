import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { isAdmin } from "../lib/admin";
import { db, getSettings } from "../data/db";
import type { Question, SubPart } from "../data/types";
import { bankErrorMessage, pushToBank, savedPasscode } from "../lib/share";
import { deleteQuestion } from "../lib/deleteQuestion";
import { sharedStemGroups, updateSharedStem } from "../lib/sharedStems";
import QuestionTextEditor from "./QuestionTextEditor";
import ModelAnswerEditor, { useModelAnswerImages } from "./ModelAnswerEditor";

interface Props {
  question: Question;
  mode?: "stem" | "question";
  onClose: () => void;
  onDeleted?: () => void;
}

/**
 * Edit a question in place while sitting or marking a paper. Saves to the
 * library and publishes when a passcode is on the device. Only shown to admins.
 */
export default function QuickEdit({ question, mode = "question", onClose, onDeleted }: Props) {
  const settings = useLiveQuery(getSettings, []);
  const admin = !!settings && isAdmin(settings);
  const siblings = useLiveQuery(() => db.questions.where("setId").equals(question.setId).sortBy("order"), [question.setId]);
  const stemOnly = mode === "stem";
  const legacyStem = !question.stems?.length && question.parts.length > 0;
  const panel = useRef<HTMLElement>(null);
  const [removedParts, setRemovedParts] = useState<{ parts: SubPart[]; marks: string }[]>([]);
  const [stems, setStems] = useState<string[]>(question.stems?.length ? question.stems : stemOnly && !legacyStem ? [""] : []);
  const [stemDocs, setStemDocs] = useState<unknown[]>(question.stemDocs ?? []);
  const [textDoc, setTextDoc] = useState(question.textDoc);
  const [text, setText] = useState(question.text);
  const [marks, setMarks] = useState<string>(question.marks?.toString() ?? "");
  const [parts, setParts] = useState<SubPart[]>(question.parts.map((p) => ({ ...p })));
  const [modelAnswer, setModelAnswer] = useState(question.modelAnswer ?? "");
  const [modelAnswerDoc, setModelAnswerDoc] = useState(question.modelAnswerDoc);
  const { addingImages, onBusyChange } = useModelAnswerImages();
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [publishFailed, setPublishFailed] = useState(false);
  const [savedQuestion, setSavedQuestion] = useState(question);
  const draftSnapshot = JSON.stringify(stemOnly
    ? legacyStem ? { text, textDoc } : { stems, stemDocs }
    : { stems, stemDocs, text, textDoc, marks, parts, modelAnswer, modelAnswerDoc });
  const [savedSnapshot, setSavedSnapshot] = useState(draftSnapshot);
  const dirty = draftSnapshot !== savedSnapshot;
  const groups = sharedStemGroups((siblings ?? [savedQuestion]).map(item => item.id === question.id ? savedQuestion : item));
  const scopeFor = (index: number) => {
    const group = groups.find(item => item.stemIndex === index && item.questionIds.includes(question.id));
    const numbers = group?.questionIds.map(id => (siblings ?? [question]).find(item => item.id === id)!.order + 1) ?? [question.order + 1];
    return `Used by ${numbers.length === 1 ? "Question" : "Questions"} ${numbers.join(", ")}`;
  };

  const close = () => {
    if (busy || addingImages) return;
    if (deleted) { (onDeleted ?? onClose)(); return; }
    if (dirty && !confirm("Discard your unsaved changes?")) return;
    onClose();
  };
  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); return; }
    if (event.key !== "Tab") return;
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])') ?? [])
      .filter(item => !item.closest("[hidden]") && item.getClientRects().length > 0);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); panel.current?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  useEffect(() => {
    if (!admin) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [admin]);
  useEffect(() => { if (deleted) panel.current?.focus(); }, [deleted]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const patchPart = (i: number, p: Partial<SubPart>) => setParts((ps) => ps.map((x, xi) => (xi === i ? { ...x, ...p } : x)));

  const save = async () => {
    if (addingImages || busy || !isAdmin(await getSettings())) return;
    setBusy(true);
    setMessage(null);
    setPublishFailed(false);
    const kept = stems.map((text, index) => ({ text: text.trim(), doc: stemDocs[index] })).filter(s => s.text || s.doc);
    const cleanStems = kept.map(s => s.text);
    const stemChanges: Partial<Question> = {
      stems: cleanStems.length ? cleanStems : undefined,
      stemDocs: kept.map(s => s.doc ?? null),
    };
    const changes: Partial<Question> = stemOnly ? legacyStem ? { text: text.trim(), textDoc } : stemChanges : {
      ...stemChanges,
      textDoc,
      text: text.trim(),
      marks: marks.trim() === "" ? undefined : Number(marks),
      parts: parts.map((p) => ({ ...p, text: p.text.trim(), modelAnswer: p.modelAnswer?.trim() || undefined })),
      modelAnswer: modelAnswer.trim() || undefined,
      modelAnswerDoc,
    };
    try {
      const saved = await db.transaction("rw", db.questions, db.sets, async () => {
        const current = await db.questions.where("setId").equals(question.setId).toArray();
        const original = current.find(item => item.id === question.id);
        if (!original) throw new Error("This question was removed. Close the editor and reopen the set.");
        if (!(stemOnly && legacyStem)) {
          let updated = current.map(item => item.id === question.id ? savedQuestion : item);
          for (let i = 0; i < (savedQuestion.stems?.length ?? 0); i++) {
            updated = updateSharedStem(updated, question.id, i, (stems[i] ?? savedQuestion.stems![i]).trim(), stemDocs[i]);
          }
          for (const sibling of updated) {
            if (sibling.id === question.id) continue;
            const before = current.find(item => item.id === sibling.id)!;
            if (JSON.stringify([before.stems, before.stemDocs]) !== JSON.stringify([sibling.stems, sibling.stemDocs])) {
              await db.questions.update(sibling.id, { stems: sibling.stems, stemDocs: sibling.stemDocs });
            }
          }
        }
        await db.questions.update(question.id, changes);
        await db.sets.update(question.setId, { updatedAt: Date.now(), dirty: true });
        return { ...original, ...changes };
      });
      setSavedQuestion(saved);
      setSavedSnapshot(draftSnapshot);
      if (await savedPasscode()) {
        try {
          await pushToBank(question.setId);
        } catch (e) {
          setMessage(`Saved here, not published: ${bankErrorMessage(e)}`);
          setPublishFailed(true);
          setBusy(false);
          return;
        }
      }
      onClose();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || addingImages || !isAdmin(await getSettings())) return;
    if (!confirm("Delete this whole question and its subquestions? Its attempts on this device will also be removed. The other questions and their stems will stay.")) return;
    setBusy(true); setMessage(null);
    try {
      await deleteQuestion(question.id);
      setDeleted(true);
      if (await savedPasscode()) {
        try { await pushToBank(question.setId); }
        catch (e) {
          setMessage(`Deleted on this device. The shared library has not updated: ${bankErrorMessage(e)} Publish local changes in Settings to retry.`);
          return;
        }
      }
      (onDeleted ?? onClose)();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not delete this question."); }
    finally { setBusy(false); }
  };

  const removePart = (index: number) => {
    if (!admin || busy || addingImages) return;
    setRemovedParts(history => [...history, { parts, marks }]);
    const removedMarks = parts[index]?.marks;
    if (marks.trim() && removedMarks !== undefined) setMarks(String(Math.max(0, Number(marks) - removedMarks)));
    setParts(current => current.filter((_, i) => i !== index));
  };

  if (!admin) return null;
  if (deleted) return <><div className="amboss-backdrop" /><aside ref={panel} tabIndex={-1} onKeyDown={onDialogKeyDown} className="amboss-pane quick-edit" role="dialog" aria-modal="true" aria-label="Question deleted"><div className="amboss-pane-body stack"><h2>Question deleted</h2>{message && <p role="status">{message}</p>}<button onClick={close} disabled={busy}>Done</button></div></aside></>;

  return (
    <>
      <div className="amboss-backdrop" onClick={close} />
      <aside ref={panel} tabIndex={-1} onKeyDown={onDialogKeyDown} className="amboss-pane quick-edit" role="dialog" aria-modal="true" aria-label={stemOnly ? "Edit case stem" : "Edit question"}>
        <div className="amboss-pane-head">
          <strong>{stemOnly ? "Edit case stem" : `Edit question ${question.order + 1}`}</strong>
          <button className="small link" onClick={close} disabled={busy || addingImages} aria-label="Close editor">×</button>
        </div>
        <div className={`amboss-pane-body stack${stemOnly ? " quick-edit-stem-body" : ""}`}>
          <section className="case-stems-section" aria-label="Case stems">
          <p className="muted">The patient story, examination and results shown before the questions. You can type, paste or add pictures.</p>
          {stemOnly && legacyStem ? <div className="shared-stem-card">
            <label>Case stem</label>
            <p className="shared-stem-reference">Used by Question {question.order + 1}</p>
            <QuestionTextEditor text={text} doc={textDoc} label="Case stem" onBusyChange={value => onBusyChange("legacy-stem", value)} onChange={value => { setText(value.text); setTextDoc(value.textDoc); }} />
          </div> : <>
          {stems.map((st, i) => (
            <div key={i} className="shared-stem-card">
              <label>{i === 0 ? "Case stem" : `Case stage ${i + 1}`}</label>
              <p className="shared-stem-reference">{scopeFor(i)}. Changes update every question listed.</p>
              <QuestionTextEditor text={st} doc={stemDocs[i]} label={i === 0 ? "Case stem" : `Case stage ${i + 1}`} onBusyChange={value => onBusyChange(`stem:${i}`, value)} onChange={value => { setStems(s => s.map((x, xi) => xi === i ? value.text : x)); setStemDocs(ds => stems.map((_, xi) => xi === i ? value.textDoc : ds[xi] ?? null)); }} />
            </div>
          ))}
          <button className="small" disabled={busy || addingImages} onClick={() => setStems((s) => [...s, ""])}>{stems.length ? "+ Add case stage" : "+ Add case stem"}</button>
          </>}
          </section>
          {!stemOnly && <>
          <div>
            <div className="row spread">
              <label>Question</label>
              <span className="row"><label style={{ margin: 0 }}>Marks</label><input aria-label="Question marks" type="number" min={0} value={marks} onChange={(e) => setMarks(e.target.value)} /></span>
            </div>
            <QuestionTextEditor text={text} doc={textDoc} label="Question" onBusyChange={value => onBusyChange("prompt", value)} onChange={value => { setText(value.text); setTextDoc(value.textDoc); }} />
          </div>
          {parts.map((p, i) => (
            <div key={p.label} className="card" style={{ background: "var(--card)" }}>
              <div className="row">
                <strong>({p.label})</strong>
                <button className="small danger" aria-label={`Remove subquestion ${p.label}`} title="Remove subquestion" onClick={() => removePart(i)} disabled={busy || addingImages}>×</button>
                <span style={{ flex: 1 }} />
                <label style={{ margin: 0 }}>Marks</label>
                <input aria-label={`Marks for subquestion ${p.label}`} type="number" min={0} value={p.marks ?? ""} onChange={(e) => patchPart(i, { marks: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </div>
              <QuestionTextEditor text={p.text} doc={p.textDoc} label={`Subquestion ${p.label}`} onBusyChange={value => onBusyChange(`prompt:${i}`, value)} onChange={value => patchPart(i, value)} />
              <label>Model answer</label>
              <ModelAnswerEditor answer={p} label={`Model answer for part ${p.label}`} onChange={(value) => patchPart(i, value)} onBusyChange={(value) => onBusyChange(`part:${i}`, value)} />
            </div>
          ))}
          {removedParts.length > 0 && <div className="row" role="status">
            <span>Subquestion removed. Save to apply.</span>
            <button className="small" disabled={busy || addingImages} onClick={() => {
              const previous = removedParts[removedParts.length - 1];
              setParts(previous.parts);
              setMarks(previous.marks);
              setRemovedParts(history => history.slice(0, -1));
            }}>Undo</button>
          </div>}
          <div>
            <label>{parts.length ? "Whole-question answer (optional)" : "Model answer"}</label>
            <ModelAnswerEditor answer={{ modelAnswer, modelAnswerDoc }} onChange={(value) => { setModelAnswer(value.modelAnswer ?? ""); setModelAnswerDoc(value.modelAnswerDoc); }} onBusyChange={(value) => onBusyChange("whole", value)} />
          </div>
          </>}
        </div>
        <div className="quick-edit-actions">
          {message ? <p className="editor-status field-error" role="alert">{message}</p> : <p className="editor-status" role="status">{dirty ? "Unsaved changes" : "No changes yet"}{settings?.bankPasscode ? ". Saving updates the shared library." : ". Saves on this device."}</p>}
          <div className="row">
            <button className="primary" onClick={save} disabled={busy || addingImages}>{addingImages ? "Adding pictures…" : busy ? "Saving…" : publishFailed && !dirty ? "Retry publishing" : settings?.bankPasscode ? "Save and publish" : "Save"}</button>
            <button onClick={close} disabled={busy || addingImages}>{publishFailed && !dirty ? "Close" : "Cancel"}</button>
            <span style={{ flex: 1 }} />
            {!stemOnly && <button className="danger" onClick={() => void remove()} disabled={busy || addingImages}>Delete question</button>}
          </div>
        </div>
      </aside>
    </>
  );
}
