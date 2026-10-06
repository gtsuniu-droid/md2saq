import { useMemo } from "react";
import NoteEditor from "./NoteEditor";
import { answerDocument } from "../lib/modelAnswer";

/** Keeps searchable plain text alongside the editable rich document. */
export default function QuestionTextEditor({ text, doc, label, onChange, onBusyChange }: {
  text: string; doc?: unknown; label: string;
  onChange: (value: { text: string; textDoc: unknown }) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const initial = useMemo(() => answerDocument({ modelAnswer: text, modelAnswerDoc: doc }), [text, doc]);
  return <div className="question-text-editor"><NoteEditor compact initial={initial} syncContent label={label} onBusyChange={onBusyChange}
    onChange={(textDoc, text) => onChange({ text, textDoc })} /></div>;
}
