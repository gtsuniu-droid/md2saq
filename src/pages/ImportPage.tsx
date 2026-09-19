import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { db, newId } from "../data/db";
import type { Question, QuestionSet } from "../data/types";
import { parseQuestions, questionFullText, type ParsedQuestion } from "../lib/parser";
import { suggestPresentations } from "../lib/suggest";
import PresentationPicker from "../components/PresentationPicker";
import { partLabel } from "../lib/questions";
import { presentationName } from "../data/presentations";
import { PasscodeError, forgetPasscode, savedPasscode, shareSet } from "../lib/share";

interface Draft extends ParsedQuestion {
  key: string;
  presentations: string[];
  suggested: string[];
}

export default function ImportPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const presetPresentation = params.get("presentation") ?? "";
  const [raw, setRaw] = useState("");
  const [name, setName] = useState(presetPresentation ? `${presentationName(presetPresentation)} set` : "");
  const [source, setSource] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [setPresentations, setSetPresentations] = useState<string[]>(presetPresentation ? [presetPresentation] : []);
  const [saving, setSaving] = useState(false);
  const [askPasscode, setAskPasscode] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [shareError, setShareError] = useState<string | null>(null);

  // Re-parse when the paste changes. Manual edits to drafts are kept until the paste changes again.
  useEffect(() => {
    const t = setTimeout(() => {
      const parsed = parseQuestions(raw);
      setDrafts(
        parsed.map((q) => {
          const suggested = suggestPresentations(questionFullText(q));
          const presentations = presetPresentation ? [presetPresentation] : suggested.slice(0, 1);
          return { ...q, key: newId(), presentations, suggested };
        }),
      );
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

  const applySetPresentations = () =>
    setDrafts((ds) => ds.map((d) => ({ ...d, presentations: [...new Set([...d.presentations, ...setPresentations])] })));

  const totalMarks = useMemo(() => drafts.reduce((acc, d) => acc + (d.marks ?? 0), 0), [drafts]);

  const save = async (share = false) => {
    if (drafts.length === 0) return;
    let code = "";
    if (share) {
      code = passcode || (await savedPasscode());
      if (!code) {
        setAskPasscode(true);
        return;
      }
    }
    setSaving(true);
    const set: QuestionSet = { id: newId(), name: name.trim() || `Set ${new Date().toLocaleDateString()}`, source: source.trim() || undefined, createdAt: Date.now() };
    const questions: Question[] = drafts.map((d, i) => ({
      id: newId(),
      setId: set.id,
      order: i,
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
    if (share) {
      try {
        await shareSet(set.id, code);
      } catch (e) {
        setSaving(false);
        if (e instanceof PasscodeError) {
          await forgetPasscode();
          setPasscode("");
          setAskPasscode(true);
          setShareError("Wrong passcode. The set was saved locally; enter the passcode to share it.");
        } else {
          setShareError(`Saved locally, but sharing failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        // The set now exists locally, so further clicks should share, not re-save.
        nav(`/library?set=${set.id}`, { replace: true });
        return;
      }
    }
    setSaving(false);
    nav(`/library?set=${set.id}`);
  };

  return (
    <div>
      <h1>Import questions</h1>
      <p className="muted">
        Paste questions in any of these shapes: numbered (1. / Q1 / Question 1), blank-line separated, sub-parts as (a) or 1),
        marks as (4 marks) or [4], and model answers after a line starting with "Answer:" or "Model answer:".
      </p>
      <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Paste here" style={{ minHeight: "12rem" }} />

      {drafts.length > 0 && (
        <>
          <div className="row" style={{ marginTop: "1rem" }}>
            <input type="text" placeholder="Set name" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="text" placeholder="Source (optional)" value={source} onChange={(e) => setSource(e.target.value)} />
            <span className="muted">{drafts.length} questions{totalMarks ? ` · ${totalMarks} marks` : ""}</span>
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
                <textarea value={d.text} onChange={(e) => update(d.key, { text: e.target.value })} style={{ minHeight: "4rem", marginTop: "0.5rem" }} />
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
            <button className="primary" onClick={() => save(false)} disabled={saving}>Save {drafts.length} questions</button>
            {askPasscode ? (
              <>
                <input type="password" placeholder="Bank passcode" value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && passcode) void save(true); }} />
                <button onClick={() => save(true)} disabled={saving || !passcode}>Save and share</button>
                <button onClick={() => setAskPasscode(false)}>Cancel</button>
              </>
            ) : (
              <button onClick={() => save(true)} disabled={saving}>Save and share to bank</button>
            )}
            {shareError && <span style={{ color: "var(--bad)" }}>{shareError}</span>}
          </div>
        </>
      )}
    </div>
  );
}
