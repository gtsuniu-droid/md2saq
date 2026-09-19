import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { db, getSettings, newId } from "../data/db";
import type { Question, QuestionSet, SubPart } from "../data/types";
import PresentationPicker from "../components/PresentationPicker";
import { updateBankSet } from "../lib/bank";
import { exportSet } from "../lib/exportImport";
import { partLabel } from "../lib/questions";
import { PasscodeError, forgetPasscode, savedPasscode } from "../lib/share";

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
    return { set, questions, unlocked: !!settings.bankPasscode };
  }, [id]);

  const [set, setSet] = useState<QuestionSet | null>(null);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [tagsText, setTagsText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askPasscode, setAskPasscode] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [seeded, setSeeded] = useState(false);

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
  const move = (key: string, dir: -1 | 1) =>
    setQuestions((qs) => {
      const i = qs.findIndex((q) => q.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= qs.length) return qs;
      const copy = [...qs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const saveLocal = async (): Promise<QuestionSet> => {
    const tags = tagsText.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    const nextSet: QuestionSet = { ...set, tags: tags.length ? tags : undefined, updatedAt: Date.now() };
    const nextQuestions: Question[] = questions.map((q, i) => {
      const { key: _k, ...rest } = q;
      void _k;
      return { ...rest, order: i, stems: q.stems?.filter((s) => s.trim()).length ? q.stems.filter((s) => s.trim()) : undefined };
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
    try {
      await saveLocal();
      nav(`/set/${set.id}`);
    } finally {
      setBusy(false);
    }
  };

  const saveAndUpdateBank = async (code?: string) => {
    const pass = code || passcode || (await savedPasscode());
    if (!pass) {
      setAskPasscode(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveLocal();
      if (!saved.bankId) throw new Error("This set is not in the bank.");
      const pack = await exportSet(saved.id);
      const entry = await updateBankSet(saved.bankId, pack, pass);
      await db.sets.update(saved.id, { bankUpdatedAt: entry.updatedAt ?? Date.now() });
      nav(`/set/${set.id}`);
    } catch (e) {
      if (e instanceof PasscodeError) {
        await forgetPasscode();
        setPasscode("");
        setAskPasscode(true);
        setMessage("Wrong passcode. Saved locally only.");
      } else {
        setMessage(`Saved locally, but the bank was not updated: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="muted"><Link to={`/set/${set.id}`}>{data.set.name}</Link></div>
      <h1 style={{ marginTop: "0.3rem" }}>Edit set</h1>

      <div className="card stack">
        <div>
          <label>Name</label>
          <input type="text" style={{ width: "100%" }} value={set.name} onChange={(e) => patchSet({ name: e.target.value })} />
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Collection</label>
            <input type="text" style={{ width: "100%" }} value={set.collection ?? ""} placeholder="e.g. Dizziness SAQ Bank" onChange={(e) => patchSet({ collection: e.target.value || undefined })} />
          </div>
          <div>
            <label>Suggested minutes</label>
            <input type="number" min={0} value={set.suggestedMinutes ?? ""} onChange={(e) => patchSet({ suggestedMinutes: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
        </div>
        <div>
          <label>Conditions and other tags, comma separated</label>
          <input type="text" style={{ width: "100%" }} value={tagsText} placeholder="Vestibular neuritis, Posterior circulation stroke" onChange={(e) => setTagsText(e.target.value)} />
        </div>
        <div>
          <label>Instructions shown at the top of the paper</label>
          <textarea value={set.instructions ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchSet({ instructions: e.target.value || undefined })} />
        </div>
        <div>
          <label>Marking notes shown while marking</label>
          <textarea value={set.markingNotes ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchSet({ markingNotes: e.target.value || undefined })} />
        </div>
        <div>
          <label>Debrief shown after marking (common errors, references)</label>
          <textarea value={set.debrief ?? ""} style={{ minHeight: "3rem" }} onChange={(e) => patchSet({ debrief: e.target.value || undefined })} />
        </div>
      </div>

      <h2>Questions</h2>
      <div className="stack">
        {questions.map((q, i) => (
          <div key={q.key} className="card">
            <div className="row spread">
              <strong>Question {i + 1}</strong>
              <span className="row">
                <label style={{ margin: 0 }}>Marks</label>
                <input type="number" min={0} value={q.marks ?? ""} onChange={(e) => patchQ(q.key, { marks: e.target.value === "" ? undefined : Number(e.target.value) })} />
                <button className="small link" onClick={() => move(q.key, -1)} disabled={i === 0}>↑</button>
                <button className="small link" onClick={() => move(q.key, 1)} disabled={i === questions.length - 1}>↓</button>
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
            <button className="small link" onClick={() => patchQ(q.key, { stems: [...(q.stems ?? []), ""] })}>+ Add stem</button>
            <label>Question</label>
            <textarea value={q.text} style={{ minHeight: "4rem" }} onChange={(e) => patchQ(q.key, { text: e.target.value })} />
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
      </div>

      <div className="row" style={{ marginTop: "1.5rem" }}>
        <button className="primary" onClick={save} disabled={busy}>Save</button>
        {set.bankId && data.unlocked && !askPasscode && (
          <button onClick={() => saveAndUpdateBank()} disabled={busy}>Save and update bank</button>
        )}
        {askPasscode && (
          <>
            <input type="password" placeholder="Bank passcode" value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && passcode) void saveAndUpdateBank(passcode); }} />
            <button onClick={() => saveAndUpdateBank(passcode)} disabled={!passcode || busy}>Update bank</button>
            <button onClick={() => setAskPasscode(false)}>Cancel</button>
          </>
        )}
        <Link to={`/set/${set.id}`}>Discard changes</Link>
        {message && <span style={{ color: "var(--bad)" }}>{message}</span>}
      </div>
    </div>
  );
}
