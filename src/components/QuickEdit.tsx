import { useState } from "react";
import { db } from "../data/db";
import type { Question, SubPart } from "../data/types";
import { bankErrorMessage, pushToBank, savedPasscode } from "../lib/share";
import { deleteQuestion } from "../lib/deleteQuestion";
import AutoTextarea from "../components/AutoTextarea";
import ModelAnswerEditor, { useModelAnswerImages } from "./ModelAnswerEditor";

interface Props {
  question: Question;
  onClose: () => void;
  /** Called after the question has been deleted (the page must stop showing it). */
  onDeleted?: () => void;
}

/**
 * Edit a question in place while sitting or marking a paper. Saves to the
 * library and publishes when a passcode is on the device. Only shown to admins.
 */
export default function QuickEdit({ question, onClose, onDeleted }: Props) {
  const [stems, setStems] = useState<string[]>(question.stems ?? []);
  const [text, setText] = useState(question.text);
  const [marks, setMarks] = useState<string>(question.marks?.toString() ?? "");
  const [parts, setParts] = useState<SubPart[]>(question.parts.map((p) => ({ ...p })));
  const [modelAnswer, setModelAnswer] = useState(question.modelAnswer ?? "");
  const [modelAnswerDoc, setModelAnswerDoc] = useState(question.modelAnswerDoc);
  const { addingImages, onBusyChange } = useModelAnswerImages();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const patchPart = (i: number, p: Partial<SubPart>) => setParts((ps) => ps.map((x, xi) => (xi === i ? { ...x, ...p } : x)));

  const save = async () => {
    if (addingImages || busy) return;
    setBusy(true);
    setMessage(null);
    const cleanStems = stems.map((s) => s.trim()).filter(Boolean);
    const next: Question = {
      ...question,
      stems: cleanStems.length ? cleanStems : undefined,
      text: text.trim(),
      marks: marks.trim() === "" ? undefined : Number(marks),
      parts: parts.map((p) => ({ ...p, text: p.text.trim(), modelAnswer: p.modelAnswer?.trim() || undefined })),
      modelAnswer: modelAnswer.trim() || undefined,
      modelAnswerDoc,
    };
    try {
      await db.transaction("rw", db.questions, db.sets, async () => {
        await db.questions.put(next);
        await db.sets.update(question.setId, { updatedAt: Date.now(), dirty: true });
      });
      if (await savedPasscode()) {
        try {
          await pushToBank(question.setId);
        } catch (e) {
          setMessage(`Saved here, not published: ${bankErrorMessage(e)}`);
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
    if (!confirm(`Delete question ${question.order + 1} from this set, with every attempt and mark on it?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteQuestion(question.id);
      if (await savedPasscode()) {
        try {
          await pushToBank(question.setId);
        } catch (e) {
          setMessage(`Deleted here, not published: ${bankErrorMessage(e)}`);
        }
      }
      onDeleted?.();
      onClose();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="amboss-backdrop" onClick={() => { if (!busy && !addingImages) onClose(); }} />
      <aside className="amboss-pane quick-edit" role="dialog" aria-label="Edit question">
        <div className="amboss-pane-head">
          <span className="muted">Edit question {question.order + 1}</span>
          <button className="small link" onClick={onClose} disabled={busy || addingImages} aria-label="Close">×</button>
        </div>
        <div className="amboss-pane-body stack">
          {stems.map((st, i) => (
            <div key={i}>
              <div className="row spread">
                <label>Stem {i + 1}</label>
                <button className="small link" onClick={() => setStems((s) => s.filter((_, x) => x !== i))}>remove</button>
              </div>
              <AutoTextarea value={st} style={{ minHeight: "5rem" }} onChange={(e) => setStems((s) => s.map((x, xi) => (xi === i ? e.target.value : x)))} />
            </div>
          ))}
          <button className="small link" onClick={() => setStems((s) => [...s, ""])}>+ Add stem</button>
          <div>
            <div className="row spread">
              <label>Question</label>
              <span className="row"><label style={{ margin: 0 }}>Marks</label><input type="number" min={0} value={marks} onChange={(e) => setMarks(e.target.value)} /></span>
            </div>
            <AutoTextarea value={text} style={{ minHeight: "5rem" }} onChange={(e) => setText(e.target.value)} />
          </div>
          {parts.map((p, i) => (
            <div key={i} className="card" style={{ background: "var(--card)" }}>
              <div className="row">
                <strong>({p.label})</strong>
                <span style={{ flex: 1 }} />
                <label style={{ margin: 0 }}>Marks</label>
                <input type="number" min={0} value={p.marks ?? ""} onChange={(e) => patchPart(i, { marks: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </div>
              <AutoTextarea value={p.text} style={{ minHeight: "3.5rem", marginTop: "0.4rem" }} onChange={(e) => patchPart(i, { text: e.target.value })} />
              <label>Model answer</label>
              <ModelAnswerEditor answer={p} label={`Model answer for part ${p.label}`} onChange={(value) => patchPart(i, value)} onBusyChange={(value) => onBusyChange(`part:${i}`, value)} />
            </div>
          ))}
          <div>
            <label>{parts.length ? "Model answer for the whole question (optional)" : "Model answer, one marking point per line"}</label>
            <ModelAnswerEditor answer={{ modelAnswer, modelAnswerDoc }} onChange={(value) => { setModelAnswer(value.modelAnswer ?? ""); setModelAnswerDoc(value.modelAnswerDoc); }} onBusyChange={(value) => onBusyChange("whole", value)} />
          </div>
          <div className="row">
            <button className="primary" onClick={save} disabled={busy || addingImages}>{addingImages ? "Adding pictures…" : "Save and publish"}</button>
            <button onClick={onClose} disabled={busy || addingImages}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button className="small danger" onClick={remove} disabled={busy || addingImages} title="Remove this question from the set">Delete question</button>
          </div>
          {message && <div style={{ color: "var(--bad)" }}>{message}</div>}
        </div>
      </aside>
    </>
  );
}
