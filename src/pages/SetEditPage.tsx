import { applyPersonalSetEdits, loadPersonalSetEdits, savePersonalSetEdits } from "../lib/personalSetEdits";
import QuestionTextEditor from "../components/QuestionTextEditor";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { db, getSettings, newId } from "../data/db";
import type { Question, QuestionImage, QuestionSet, SubPart } from "../data/types";
import PresentationPicker from "../components/PresentationPicker";
import { dataUrlBytes } from "../lib/images";
import { partLabel } from "../lib/questions";
import { loadSummaries, nextSetNumber, setLabel } from "../lib/sets";
import { knownTags, suggestConditionTags } from "../lib/tags";
import TagEditor from "../components/TagEditor";
import { primaryPresentation } from "../lib/primaryPresentation";
import { PRESENTATIONS, presentationName } from "../data/presentations";
import { isAdmin } from "../lib/admin";
import { bankErrorMessage, pushToBank } from "../lib/share";
import { recordDeletes } from "../lib/sync";
import AutoTextarea from "../components/AutoTextarea";
import ModelAnswerEditor, { useModelAnswerImages } from "../components/ModelAnswerEditor";
import { sharedStemGroups, updateSharedStem, type SharedStemMembership } from "../lib/sharedStems";
import { clearSetEditorDraft, loadSetEditorDraft, writeSetEditorDraft, type SetEditorDraft } from "../lib/setEditorDrafts";

interface DraftQuestion extends Question {
  key: string;
}

export default function SetEditPage({ embeddedSetId, onDone }: { embeddedSetId?: string; onDone?: (message?: string) => void } = {}) {
  const { id: routeId = "" } = useParams();
  const id = embeddedSetId ?? routeId;
  const embedded = !!embeddedSetId;
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const set = await db.sets.get(id);
    if (!set) return null;
    const questions = await db.questions.where("setId").equals(id).sortBy("order");
    const settings = await getSettings();
    const admin = isAdmin(settings);
    const ownerId = settings.cloudUser?.uid ?? "";
    const personal = embedded && !admin ? (await loadPersonalSetEdits(ownerId)).get(id) : undefined;
    return { set, questions: applyPersonalSetEdits(questions, personal), originalQuestions: questions, canPush: admin && !!settings.bankPasscode, admin, ownerId };
  }, [id]);

  const [set, setSet] = useState<QuestionSet | null>(null);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const known = useLiveQuery(async () => knownTags((await loadSummaries()).flatMap((s) => s.set.tags ?? [])), []) ?? [];
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { addingImages, onBusyChange } = useModelAnswerImages();
  const [seeded, setSeeded] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [draftWarning, setDraftWarning] = useState("");
  const [restored, setRestored] = useState(false);
  const savedSnapshot = useRef("");
  const draftBase = useRef<{ ownerId: string; set: QuestionSet } | null>(null);
  const lastWrittenDraft = useRef<SetEditorDraft | null>(null);
  const recoverable = useRef<{ ownerId: string; base: QuestionSet; draft: SetEditorDraft } | null>(null);
  const previousStemGroups = useRef<SharedStemMembership[]>([]);
  const stemGroups = sharedStemGroups(questions, previousStemGroups.current);
  const currentDraft: SetEditorDraft | null = set ? { set, questions: questions.map(({ key: _key, ...question }) => { void _key; return question; }), tags, sharedStems: stemGroups.map(({ stemIndex, questionIds }) => ({ stemIndex, questionIds })) } : null;
  const snapshot = JSON.stringify(currentDraft);
  const dirty = seeded && snapshot !== savedSnapshot.current;
  recoverable.current = dirty && currentDraft && draftBase.current ? { ownerId: draftBase.current.ownerId, base: draftBase.current.set, draft: currentDraft } : null;

  useEffect(() => {
    if (!data || seeded) return;
    const nextSet = { ...data.set, primaryPresentation: primaryPresentation(data.set, data.questions) };
    const nextTags = data.set.tags ?? [];
    const sharedStems = sharedStemGroups(data.questions).map(({ stemIndex, questionIds }) => ({ stemIndex, questionIds }));
    const baseline: SetEditorDraft = { set: nextSet, questions: data.questions, tags: nextTags, sharedStems };
    savedSnapshot.current = JSON.stringify(baseline);
    draftBase.current = { ownerId: data.ownerId, set: data.set };
    const recovered = loadSetEditorDraft(data.ownerId, data.set);
    const next = recovered ?? baseline;
    previousStemGroups.current = next.sharedStems ?? sharedStems;
    lastWrittenDraft.current = recovered;
    setRestored(!!recovered);
    setSet(next.set);
    setQuestions(next.questions.map((q) => ({ ...q, key: q.id })));
    setTags(next.tags);
    setSeeded(true);
  }, [data, seeded]);

  useEffect(() => {
    if (seeded) previousStemGroups.current = stemGroups;
  }, [questions, seeded]);

  useEffect(() => {
    const pending = recoverable.current;
    if (pending) {
      const stored = writeSetEditorDraft(pending.ownerId, pending.base, pending.draft);
      if (stored) lastWrittenDraft.current = pending.draft;
      setDraftWarning(stored ? "" : "Draft recovery is unavailable. Save before leaving this page.");
    } else if (seeded && draftBase.current && lastWrittenDraft.current) {
      clearSetEditorDraft(draftBase.current.ownerId, draftBase.current.set.id, lastWrittenDraft.current);
      lastWrittenDraft.current = null;
      setDraftWarning("");
    }
  }, [snapshot, seeded]);

  useEffect(() => {
    const retainLatestDraft = () => {
      const pending = recoverable.current;
      if (pending) writeSetEditorDraft(pending.ownerId, pending.base, pending.draft);
    };
    window.addEventListener("pagehide", retainLatestDraft);
    return () => {
      retainLatestDraft();
      window.removeEventListener("pagehide", retainLatestDraft);
    };
  }, []);

  useEffect(() => {
    if (!dirty && !addingImages) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, addingImages]);

  useEffect(() => {
    if (!seeded || window.location.hash !== "#case-stems") return;
    const frame = requestAnimationFrame(() => document.getElementById("case-stems")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [seeded]);

  if (data === undefined) return null;
  if (data === null) return <p>Set not found.</p>;
  if (!data.admin && !embedded) return <p className="muted">Editing sets is limited to the site's admin account.</p>;
  if (!set) return null;

  const patchSet = (p: Partial<QuestionSet>) => setSet((s) => (s ? { ...s, ...p } : s));
  const patchQ = (key: string, p: Partial<Question>) => setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...p } : q)));
  const patchPart = (key: string, pi: number, p: Partial<SubPart>) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, parts: q.parts.map((x, i) => (i === pi ? { ...x, ...p } : x)) } : q)));
  const removeQ = (key: string) => setQuestions((qs) => qs.filter((q) => q.key !== key));
  const addQ = () =>
    setQuestions((qs) => [
      ...qs,
      { key: newId(), id: newId(), setId: set.id, order: qs.length, text: "", parts: [], presentations: [], tags: [], createdAt: Date.now(), stems: qs[qs.length - 1]?.stems, stemDocs: qs[qs.length - 1]?.stemDocs },
    ]);
  const addPart = (key: string) =>
    setQuestions((qs) =>
      qs.map((q) => (q.key === key ? { ...q, parts: [...q.parts, { label: String.fromCharCode(97 + q.parts.length), text: "" }] } : q)),
    );
  const removePart = (key: string, pi: number) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, parts: q.parts.filter((_, i) => i !== pi) } : q)));
  const editStem = (groupId: string) => {
    const target = document.getElementById(groupId);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus({ preventScroll: true });
  };
  const addStem = (question: DraftQuestion) => {
    const stemIndex = question.stems?.length ?? 0;
    const next = questions.map((item) => item.id === question.id ? {
      ...item, stems: [...(item.stems ?? []), ""], stemDocs: [...(item.stems ?? []).map((_, i) => item.stemDocs?.[i] ?? null), null],
    } : item);
    setQuestions(next);
    const group = sharedStemGroups(next, previousStemGroups.current).find((item) => item.stemIndex === stemIndex && item.questionIds.includes(question.id));
    if (group) requestAnimationFrame(() => editStem(group.id));
  };
  const canLeave = () => {
    if (dirty && !confirm("Discard your unsaved changes to this set?")) return false;
    if (currentDraft) clearSetEditorDraft(data.ownerId, set.id, currentDraft);
    if (lastWrittenDraft.current) clearSetEditorDraft(data.ownerId, set.id, lastWrittenDraft.current);
    recoverable.current = null;
    lastWrittenDraft.current = null;
    return true;
  };

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
    if (addingImages || busy) return;
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

  const patchImage = (key: string, imgId: string, p: Partial<QuestionImage>) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, images: (q.images ?? []).map((im) => (im.id === imgId ? { ...im, ...p } : im)) } : q)));
  const removeImage = (key: string, imgId: string) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, images: (q.images ?? []).filter((im) => im.id !== imgId) } : q)));

  const saveLocal = async (): Promise<QuestionSet> => {
    const latestSettings = await getSettings();
    if ((latestSettings.cloudUser?.uid ?? "") !== data.ownerId || isAdmin(latestSettings) !== data.admin) throw new Error("Your account changed. Reopen this set before saving.");
    if (!isAdmin(latestSettings)) {
      if (!embedded) throw new Error("Only an admin can change the shared library.");
      await savePersonalSetEdits(data.ownerId, set.id, data.originalQuestions, questions);
      return set;
    }
    const number = set.primaryPresentation && set.primaryPresentation !== primaryPresentation(data.set, data.questions) ? await nextSetNumber(set.primaryPresentation) : set.number;
    const nextSet: QuestionSet = { ...set, number, tags: tags.length ? tags : undefined, updatedAt: Date.now(), dirty: true };
    const nextQuestions: Question[] = questions.map((q, i) => {
      const { key: _k, ...rest } = q;
      void _k;
      const kept = (q.stems ?? []).map((text, i) => ({ text, doc: q.stemDocs?.[i] })).filter(s => s.text.trim() || s.doc);
      const stems = kept.map(s => s.text);
      return { ...rest, order: i, stemDocs: kept.map(s => s.doc ?? null), stems: stems?.length ? stems : undefined, images: q.images?.length ? q.images : undefined };
    });
    const keep = new Set(nextQuestions.map((q) => q.id));
    const gone = data.questions.filter((q) => !keep.has(q.id)).map((q) => q.id);
    const goneAttempts = gone.length ? ((await db.attempts.where("questionId").anyOf(gone).primaryKeys()) as string[]) : [];
    const goneMarks = gone.length ? ((await db.marks.where("questionId").anyOf(gone).primaryKeys()) as string[]) : [];
    await db.transaction("rw", db.sets, db.questions, db.attempts, db.marks, async () => {
      await db.sets.put(nextSet);
      await db.questions.bulkPut(nextQuestions);
      if (gone.length) {
        await db.marks.where("questionId").anyOf(gone).delete();
        await db.attempts.where("questionId").anyOf(gone).delete();
        await db.questions.bulkDelete(gone);
      }
    });
    await recordDeletes("attempts", goneAttempts);
    await recordDeletes("marks", goneMarks);
    return nextSet;
  };

  const save = async () => {
    if (addingImages || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveLocal();
      savedSnapshot.current = snapshot;
      recoverable.current = null;
      if (currentDraft) clearSetEditorDraft(data.ownerId, saved.id, currentDraft);
      lastWrittenDraft.current = null;
      setDraftWarning("");
      let note = data.admin ? "Saved on this device." : "Personal edits saved on this device.";
      if (data.canPush && isAdmin(await getSettings())) {
        try {
          await pushToBank(saved.id);
          note = "Saved and published.";
        } catch (e) {
          note = `Saved on this device but not published: ${bankErrorMessage(e)}`;
        }
      }
      if (onDone) onDone(note);
      else nav(`/set/${set.id}`, { state: { message: note } });
    } catch (error) {
      setMessage(`Could not save this set. Your changes are still here. ${error instanceof Error ? error.message : "Please try again."}`);
    } finally {
      setBusy(false);
    }
  };

  const totalImageBytes = questions.reduce((acc, q) => acc + (q.images ?? []).reduce((a, im) => a + dataUrlBytes(im.dataUrl), 0), 0);

  return (
    <div className={`set-editor${embedded ? " browse-editor" : ""}`}>
      {!embedded && <><div className="muted"><Link to={`/set/${set.id}`} onClick={(event) => { if (!canLeave()) event.preventDefault(); }}>{setLabel(data.set)}</Link></div>
      <h1 style={{ marginTop: "0.3rem" }}>Edit {setLabel(set)}</h1></>}
      {restored && <p className="muted" role="status">Unsaved draft restored.</p>}

      {data.admin && <details className="card">
        <summary>Set details</summary>
        <div className="stack" style={{ marginTop: "1rem" }}>
        <label htmlFor="set-editor-presentation">Primary presentation
          <select id="set-editor-presentation" value={set.primaryPresentation ?? ""} onChange={(e) => patchSet({ primaryPresentation: e.target.value || undefined })}>
            <option value="">Choose the main presenting complaint</option>
            {PRESENTATIONS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Tags</label>
            <TagEditor value={tags} onChange={setTags} known={known}
              suggestions={[...new Set([...questions.flatMap((q) => q.presentations).map(presentationName), ...suggestConditionTags(questions)])]} />
          </div>
          <div>
            <label htmlFor="set-editor-minutes">Suggested minutes</label>
            <input id="set-editor-minutes" type="number" min={0} value={set.suggestedMinutes ?? ""} onChange={(e) => patchSet({ suggestedMinutes: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
        </div>
        <div>
          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="set-editor-title">Title</label>
              <input id="set-editor-title" type="text" style={{ width: "100%" }} value={set.source ?? ""} placeholder="e.g. Case 02: Dizziness after a recent respiratory illness" onChange={(e) => patchSet({ source: e.target.value || undefined })} />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="set-editor-collection">Collection</label>
              <input id="set-editor-collection" type="text" style={{ width: "100%" }} value={set.collection ?? ""} placeholder="e.g. Dizziness SAQ Bank" onChange={(e) => patchSet({ collection: e.target.value || undefined })} />
            </div>
          </div>
          <label htmlFor="set-editor-instructions">Instructions shown at the top of the paper</label>
          <AutoTextarea id="set-editor-instructions" value={set.instructions ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchSet({ instructions: e.target.value || undefined })} />
          <label htmlFor="set-editor-marking-notes">Marking notes shown while marking</label>
          <AutoTextarea id="set-editor-marking-notes" value={set.markingNotes ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchSet({ markingNotes: e.target.value || undefined })} />
          <label htmlFor="set-editor-debrief">Debrief shown after marking</label>
          <AutoTextarea id="set-editor-debrief" value={set.debrief ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchSet({ debrief: e.target.value || undefined })} />
        </div>
        </div>
      </details>}

      <section id="case-stems" className="case-stems-section" aria-labelledby="case-stems-heading">
        <h2 id="case-stems-heading">{stemGroups.length > 1 ? "Case stems" : "Case stem"}</h2>
        {!stemGroups.length && <p className="muted">No separate case stems yet. Use “Add stem” in a question below to create one.</p>}
        {stemGroups.map((group, groupIndex) => <article key={group.id} id={group.id} className="card shared-stem-card" tabIndex={-1}>
          <header className="row spread">
            <div>
              <h3>{stemGroups.length === 1 ? "Case stem" : `Case stem ${groupIndex + 1}`} {group.stemIndex > 0 ? `— Stage ${group.stemIndex + 1}` : ""}</h3>
              <p className="muted">Used by {group.questionNumbers.length === 1 ? "Question" : "Questions"} {group.questionNumbers.join(", ")}</p>
            </div>
          </header>
          <QuestionTextEditor text={group.text} doc={group.doc} label={`Case stem ${groupIndex + 1}, used by questions ${group.questionNumbers.join(", ")}`} onBusyChange={(value) => onBusyChange(group.id, value)} onChange={(value) => setQuestions((current) => updateSharedStem(current, group.sourceQuestionId, group.stemIndex, value.text, value.textDoc, group.questionIds))} />
        </article>)}
      </section>

      <h2>Questions</h2>

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
                <span className="drag-handle" hidden={!data.admin} draggable={data.admin && !addingImages && !busy} onDragStart={onDragStart(q.key)} onDragEnd={() => { setDragKey(null); setOverKey(null); }} title="Drag to reorder">⋮⋮</span>
                <strong>Question {i + 1}</strong>
              </span>
              <span className="row">
                <label style={{ margin: 0 }}>Marks</label>
                <input aria-label={`Marks for question ${i + 1}`} type="number" min={0} value={q.marks ?? ""} onChange={(e) => patchQ(q.key, { marks: e.target.value === "" ? undefined : Number(e.target.value) })} />
                {data.admin && <button className="small danger" disabled={addingImages} onClick={() => removeQ(q.key)}>Remove</button>}
              </span>
            </div>
            {!embedded && (q.stems ?? []).map((st, si) => {
              const group = stemGroups.find((item) => item.stemIndex === si && item.questionIds.includes(q.id));
              return <div key={si} className="shared-stem-reference">
                <div className="row spread">
                  <strong>{si === 0 ? "Case stem" : `Stage ${si + 1}`}</strong>
                  <span className="row">
                    {group && <button className="small" onClick={() => editStem(group.id)}>Edit {group.questionIds.length > 1 ? "shared stem" : "stem"}</button>}
                    <button className="small link" disabled={addingImages} onClick={() => patchQ(q.key, { stems: (q.stems ?? []).filter((_, x) => x !== si), stemDocs: q.stemDocs?.filter((_, x) => x !== si) })}>Remove from this question</button>
                  </span>
                </div>
                <p className="muted">{st.trim() ? `${st.slice(0, 170)}${st.length > 170 ? "…" : ""}` : q.stemDocs?.[si] ? "Rich case stem — open to view or edit." : "Empty stem — open to add case details."}</p>
              </div>;
            })}
            <div className="row" style={{ marginTop: "0.4rem" }}>
              <button className="small link" disabled={addingImages} onClick={() => addStem(q)}>+ Add stem to this question</button>
            </div>
            {(q.images ?? []).filter((im) => im.place === "stem").map((im) => (
              <ImageRow key={im.id} img={im} onCaption={(c) => patchImage(q.key, im.id, { caption: c })} onRemove={() => removeImage(q.key, im.id)} />
            ))}
            <label>Question</label>
            <QuestionTextEditor text={q.text} doc={q.textDoc} label={`Question ${i + 1}`} onBusyChange={value => onBusyChange(`${q.key}:prompt`, value)} onChange={value => patchQ(q.key, value)} />
            {(q.images ?? []).filter((im) => im.place === "question").map((im) => (
              <ImageRow key={im.id} img={im} onCaption={(c) => patchImage(q.key, im.id, { caption: c })} onRemove={() => removeImage(q.key, im.id)} />
            ))}
            {q.parts.map((p, pi) => (
              <div key={pi} className="card" style={{ marginTop: "0.6rem", background: "var(--bg)" }}>
                <div className="row">
                  <input aria-label={`Part label for question ${i + 1}, part ${pi + 1}`} type="text" value={p.label} style={{ width: "4rem" }} onChange={(e) => patchPart(q.key, pi, { label: e.target.value })} title="Part label" />
                  <span className="muted">{partLabel(p.label)}</span>
                  <span style={{ flex: 1 }} />
                  <label style={{ margin: 0 }}>Marks</label>
                  <input aria-label={`Marks for question ${i + 1}, part ${p.label || pi + 1}`} type="number" min={0} value={p.marks ?? ""} onChange={(e) => patchPart(q.key, pi, { marks: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  {data.admin && <button className="small danger" disabled={addingImages} onClick={() => removePart(q.key, pi)}>Remove part</button>}
                </div>
                <QuestionTextEditor text={p.text} doc={p.textDoc} label={`Question ${i + 1}, part ${p.label}`} onBusyChange={value => onBusyChange(`${q.key}:prompt:${pi}`, value)} onChange={value => patchPart(q.key, pi, value)} />
                <details className="browse-edit-answer"><summary>Model answer</summary>
                <ModelAnswerEditor answer={p} label={`Model answer for question ${i + 1}, part ${p.label}`} onChange={(value) => patchPart(q.key, pi, value)} onBusyChange={(value) => onBusyChange(`${q.key}:part:${pi}`, value)} /></details>
              </div>
            ))}
            {data.admin && <button className="small link" style={{ marginTop: "0.4rem" }} onClick={() => addPart(q.key)}>+ Add part</button>}
            <details className="browse-edit-answer"><summary>{q.parts.length ? "Whole-question answer" : "Model answer"}</summary>
            <ModelAnswerEditor answer={q} label={`Model answer for question ${i + 1}`} onChange={(value) => patchQ(q.key, value)} onBusyChange={(value) => onBusyChange(`${q.key}:whole`, value)} /></details>
            {data.admin && <details><summary>Presentations</summary>
            <PresentationPicker selected={q.presentations} onChange={(ids) => patchQ(q.key, { presentations: ids })} /></details>}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: "0.8rem" }}>
        {data.admin && <button className="small link" onClick={addQ}>+ Add question</button>}
        {totalImageBytes > 0 && <span className="muted">{(totalImageBytes / 1e6).toFixed(1)} MB of pictures{totalImageBytes > 5e6 ? ", too much to publish" : ""}</span>}
      </div>

      <div className="row set-editor-actions" aria-label="Save set edits">
        <span className="editor-status" role="status">{busy ? "Saving…" : dirty ? draftWarning ? "Unsaved changes" : "Draft kept on this device" : "No unsaved changes"}</span>
        <button className="primary" onClick={save} disabled={busy || addingImages}>{busy ? "Saving…" : addingImages ? "Adding pictures…" : data.canPush ? "Save and publish" : data.admin ? "Save" : "Save on this device"}</button>
        <button disabled={busy || addingImages} onClick={() => { if (canLeave()) { if (onDone) onDone(); else nav(`/set/${set.id}`); } }}>{dirty ? "Discard changes" : embedded ? "Done" : "Back to set"}</button>
        {message && <span className="field-error" role="alert">{message}</span>}
        {draftWarning && <span className="field-error" role="alert">{draftWarning}</span>}
      </div>
    </div>
  );
}

function ImageRow({ img, onCaption, onRemove }: { img: QuestionImage; onCaption: (c: string) => void; onRemove: () => void }) {
  return (
    <div className="row img-row">
      <img src={img.dataUrl} alt={img.caption ?? ""} />
      <input aria-label="Picture caption" type="text" placeholder="Caption (optional)" value={img.caption ?? ""} onChange={(e) => onCaption(e.target.value)} style={{ flex: 1 }} />
      <button className="small danger" onClick={onRemove}>Remove</button>
    </div>
  );
}
