import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { db, getSettings, newId } from "../data/db";
import type { Question, QuestionImage, QuestionSet, SubPart } from "../data/types";
import PresentationPicker from "../components/PresentationPicker";
import { compressImage, dataUrlBytes } from "../lib/images";
import { partLabel } from "../lib/questions";
import { setLabel } from "../lib/sets";
import { bankErrorMessage, pushToBank } from "../lib/share";

interface DraftQuestion extends Question {
  key: string;
}

export default function SetEditPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const set = await db.sets.get(id);
    if (!set) return null;
    const questions = await db.questions.where("setId").equals(id).sortBy("order");
    const settings = await getSettings();
    return { set, questions, canPush: !!settings.bankPasscode };
  }, [id]);

  const [set, setSet] = useState<QuestionSet | null>(null);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [tagsText, setTagsText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const fileInputs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (!data || seeded) return;
    setSet(data.set);
    setQuestions(data.questions.map((q) => ({ ...q, key: q.id })));
    setTagsText((data.set.tags ?? []).join(", "));
    setSeeded(true);
  }, [data, seeded]);

  if (data === undefined || !set) return null;
  if (data === null) return <p>Set not found.</p>;

  const patchSet = (p: Partial<QuestionSet>) => setSet((s) => (s ? { ...s, ...p } : s));
  const patchQ = (key: string, p: Partial<Question>) => setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...p } : q)));
  const patchPart = (key: string, pi: number, p: Partial<SubPart>) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, parts: q.parts.map((x, i) => (i === pi ? { ...x, ...p } : x)) } : q)));
  const removeQ = (key: string) => setQuestions((qs) => qs.filter((q) => q.key !== key));
  const addQ = () =>
    setQuestions((qs) => [
      ...qs,
      { key: newId(), id: newId(), setId: set.id, order: qs.length, text: "", parts: [], presentations: [], tags: [], createdAt: Date.now(), stems: qs[qs.length - 1]?.stems },
    ]);
  const addPart = (key: string) =>
    setQuestions((qs) =>
      qs.map((q) => (q.key === key ? { ...q, parts: [...q.parts, { label: String.fromCharCode(97 + q.parts.length), text: "" }] } : q)),
    );
  const removePart = (key: string, pi: number) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, parts: q.parts.filter((_, i) => i !== pi) } : q)));

  // Drag a question card onto another to reorder.
  const onDragStart = (key: string) => (e: DragEvent) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
  };
  const onDragOver = (key: string) => (e: DragEvent) => {
    e.preventDefault();
    if (overKey !== key) setOverKey(key);
  };
  const onDropOn = (key: string) => (e: DragEvent) => {
    e.preventDefault();
    const from = dragKey ?? e.dataTransfer.getData("text/plain");
    setDragKey(null);
    setOverKey(null);
    if (!from || from === key) return;
    setQuestions((qs) => {
      const i = qs.findIndex((q) => q.key === from);
      const j = qs.findIndex((q) => q.key === key);
      if (i < 0 || j < 0) return qs;
      const copy = [...qs];
      const [moved] = copy.splice(i, 1);
      copy.splice(j, 0, moved);
      return copy;
    });
  };

  const addImages = async (key: string, place: QuestionImage["place"], files: File[]) => {
    if (files.length === 0) return;
    const added: QuestionImage[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const dataUrl = await compressImage(f);
        added.push({ id: newId(), dataUrl, place, caption: "" });
      } catch (e) {
        setMessage(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (added.length) setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, images: [...(q.images ?? []), ...added] } : q)));
  };
  const patchImage = (key: string, imgId: string, p: Partial<QuestionImage>) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, images: (q.images ?? []).map((im) => (im.id === imgId ? { ...im, ...p } : im)) } : q)));
  const removeImage = (key: string, imgId: string) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, images: (q.images ?? []).filter((im) => im.id !== imgId) } : q)));

  const saveLocal = async (): Promise<QuestionSet> => {
    const tags = tagsText.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    const nextSet: QuestionSet = { ...set, tags: tags.length ? tags : undefined, updatedAt: Date.now(), dirty: true };
    const nextQuestions: Question[] = questions.map((q, i) => {
      const { key: _k, ...rest } = q;
      void _k;
      const stems = q.stems?.filter((s) => s.trim());
      return { ...rest, order: i, stems: stems?.length ? stems : undefined, images: q.images?.length ? q.images : undefined };
    });
    const keep = new Set(nextQuestions.map((q) => q.id));
    await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
      await db.sets.put(nextSet);
      await db.questions.bulkPut(nextQuestions);
      const gone = data.questions.filter((q) => !keep.has(q.id)).map((q) => q.id);
      if (gone.length) {
        await db.marks.where("questionId").anyOf(gone).delete();
        await db.attempts.where("questionId").anyOf(gone).delete();
        await db.questions.bulkDelete(gone);
      }
    });
    return nextSet;
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveLocal();
      let note: string | undefined;
      if (data.canPush) {
        try {
          await pushToBank(saved.id);
          note = "Saved and pushed to the bank.";
        } catch (e) {
          note = `Saved on this device. The bank was not updated: ${bankErrorMessage(e)}`;
        }
      }
      nav(`/set/${set.id}`, { state: { message: note } });
    } finally {
      setBusy(false);
    }
  };

  const totalImageBytes = questions.reduce((acc, q) => acc + (q.images ?? []).reduce((a, im) => a + dataUrlBytes(im.dataUrl), 0), 0);

  return (
    <div>
      <div className="muted"><Link to={`/set/${set.id}`}>{setLabel(data.set)}</Link></div>
      <h1 style={{ marginTop: "0.3rem" }}>Edit {setLabel(set)}</h1>

      <div className="card stack">
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Conditions and other tags, comma separated</label>
            <input type="text" style={{ width: "100%" }} value={tagsText} placeholder="Vestibular neuritis, Posterior circulation stroke" onChange={(e) => setTagsText(e.target.value)} />
          </div>
          <div>
            <label>Suggested minutes</label>
            <input type="number" min={0} value={set.suggestedMinutes ?? ""} onChange={(e) => patchSet({ suggestedMinutes: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
        </div>
        <details>
          <summary className="muted" style={{ cursor: "pointer" }}>Title, collection, instructions, marking notes and debrief</summary>
          <div className="row">
            <div style={{ flex: 1 }}>
              <label>Title</label>
              <input type="text" style={{ width: "100%" }} value={set.source ?? ""} placeholder="e.g. Case 02: Dizziness after a recent respiratory illness" onChange={(e) => patchSet({ source: e.target.value || undefined })} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Collection</label>
              <input type="text" style={{ width: "100%" }} value={set.collection ?? ""} placeholder="e.g. Dizziness SAQ Bank" onChange={(e) => patchSet({ collection: e.target.value || undefined })} />
            </div>
          </div>
          <label>Instructions shown at the top of the paper</label>
          <textarea value={set.instructions ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchSet({ instructions: e.target.value || undefined })} />
          <label>Marking notes shown while marking</label>
          <textarea value={set.markingNotes ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchSet({ markingNotes: e.target.value || undefined })} />
          <label>Debrief shown after marking</label>
          <textarea value={set.debrief ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchSet({ debrief: e.target.value || undefined })} />
        </details>
      </div>

      <h2>Questions</h2>
      <p className="muted">Drag a question by its handle to reorder. Pictures are resized on the way in and travel with the set.</p>
      <div className="stack">
        {questions.map((q, i) => (
          <div
            key={q.key}
            className={"card qcard" + (overKey === q.key && dragKey !== q.key ? " over" : "") + (dragKey === q.key ? " dragging" : "")}
            onDragOver={onDragOver(q.key)}
            onDragLeave={() => setOverKey((k) => (k === q.key ? null : k))}
            onDrop={onDropOn(q.key)}
          >
            <div className="row spread">
              <span className="row">
                <span className="drag-handle" draggable onDragStart={onDragStart(q.key)} onDragEnd={() => { setDragKey(null); setOverKey(null); }} title="Drag to reorder">⋮⋮</span>
                <strong>Question {i + 1}</strong>
              </span>
              <span className="row">
                <label style={{ margin: 0 }}>Marks</label>
                <input type="number" min={0} value={q.marks ?? ""} onChange={(e) => patchQ(q.key, { marks: e.target.value === "" ? undefined : Number(e.target.value) })} />
                <button className="small danger" onClick={() => removeQ(q.key)}>Remove</button>
              </span>
            </div>
            {(q.stems ?? []).map((st, si) => (
              <div key={si}>
                <div className="row spread">
                  <label>Stem {si + 1}</label>
                  <button className="small link" onClick={() => patchQ(q.key, { stems: (q.stems ?? []).filter((_, x) => x !== si) })}>remove stem</button>
                </div>
                <textarea value={st} style={{ minHeight: "4rem" }} onChange={(e) => patchQ(q.key, { stems: (q.stems ?? []).map((x, xi) => (xi === si ? e.target.value : x)) })} />
              </div>
            ))}
            <div className="row" style={{ marginTop: "0.4rem" }}>
              <button className="small link" onClick={() => patchQ(q.key, { stems: [...(q.stems ?? []), ""] })}>+ Add stem</button>
              <button className="small link" onClick={() => fileInputs.current.get(q.key + ":stem")?.click()}>+ Picture with the stem</button>
              <input ref={(el) => { if (el) fileInputs.current.set(q.key + ":stem", el); }} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; void addImages(q.key, "stem", picked); }} />
            </div>
            {(q.images ?? []).filter((im) => im.place === "stem").map((im) => (
              <ImageRow key={im.id} img={im} onCaption={(c) => patchImage(q.key, im.id, { caption: c })} onRemove={() => removeImage(q.key, im.id)} />
            ))}
            <label>Question</label>
            <textarea value={q.text} style={{ minHeight: "4rem" }} onChange={(e) => patchQ(q.key, { text: e.target.value })} />
            <div className="row" style={{ marginTop: "0.4rem" }}>
              <button className="small link" onClick={() => fileInputs.current.get(q.key + ":question")?.click()}>+ Picture with the question</button>
              <input ref={(el) => { if (el) fileInputs.current.set(q.key + ":question", el); }} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; void addImages(q.key, "question", picked); }} />
            </div>
            {(q.images ?? []).filter((im) => im.place === "question").map((im) => (
              <ImageRow key={im.id} img={im} onCaption={(c) => patchImage(q.key, im.id, { caption: c })} onRemove={() => removeImage(q.key, im.id)} />
            ))}
            {q.parts.map((p, pi) => (
              <div key={pi} className="card" style={{ marginTop: "0.6rem", background: "var(--bg)" }}>
                <div className="row">
                  <input type="text" value={p.label} style={{ width: "4rem" }} onChange={(e) => patchPart(q.key, pi, { label: e.target.value })} title="Part label" />
                  <span className="muted">{partLabel(p.label)}</span>
                  <span style={{ flex: 1 }} />
                  <label style={{ margin: 0 }}>Marks</label>
                  <input type="number" min={0} value={p.marks ?? ""} onChange={(e) => patchPart(q.key, pi, { marks: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  <button className="small danger" onClick={() => removePart(q.key, pi)}>Remove part</button>
                </div>
                <textarea value={p.text} style={{ minHeight: "3rem", marginTop: "0.4rem" }} onChange={(e) => patchPart(q.key, pi, { text: e.target.value })} />
                <label>Model answer for this part</label>
                <textarea value={p.modelAnswer ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchPart(q.key, pi, { modelAnswer: e.target.value || undefined })} />
              </div>
            ))}
            <button className="small link" style={{ marginTop: "0.4rem" }} onClick={() => addPart(q.key)}>+ Add part</button>
            <label>{q.parts.length ? "Model answer for the whole question (optional)" : "Model answer, one marking point per line"}</label>
            <textarea value={q.modelAnswer ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchQ(q.key, { modelAnswer: e.target.value || undefined })} />
            <label>Presentations</label>
            <PresentationPicker selected={q.presentations} onChange={(ids) => patchQ(q.key, { presentations: ids })} />
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: "0.8rem" }}>
        <button className="small link" onClick={addQ}>+ Add question</button>
        {totalImageBytes > 0 && <span className="muted">{(totalImageBytes / 1e6).toFixed(1)} MB of pictures{totalImageBytes > 5e6 ? ", too much for the bank" : ""}</span>}
      </div>

      <div className="row" style={{ marginTop: "1.5rem" }}>
        <button className="primary" onClick={save} disabled={busy}>{data.canPush ? "Save and update bank" : "Save"}</button>
        <Link to={`/set/${set.id}`}>Discard changes</Link>
        {message && <span style={{ color: "var(--bad)" }}>{message}</span>}
      </div>
    </div>
  );
}

function ImageRow({ img, onCaption, onRemove }: { img: QuestionImage; onCaption: (c: string) => void; onRemove: () => void }) {
  return (
    <div className="row img-row">
      <img src={img.dataUrl} alt={img.caption ?? ""} />
      <input type="text" placeholder="Caption (optional)" value={img.caption ?? ""} onChange={(e) => onCaption(e.target.value)} style={{ flex: 1 }} />
      <button className="small danger" onClick={onRemove}>Remove</button>
    </div>
  );
}
