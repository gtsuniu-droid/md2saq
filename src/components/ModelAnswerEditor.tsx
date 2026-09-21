import { useCallback, useMemo, useState } from "react";
import NoteEditor from "./NoteEditor";
import { answerDocument, type ModelAnswer } from "../lib/modelAnswer";

export default function ModelAnswerEditor({ answer, label = "Model answer", onChange, onBusyChange }: {
  answer: ModelAnswer;
  label?: string;
  onChange: (answer: ModelAnswer) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const initial = useMemo(() => answerDocument(answer), [answer.modelAnswerDoc, answer.modelAnswer]);
  return <div className="model-answer-editor"><NoteEditor initial={initial} label={label} syncContent onBusyChange={onBusyChange}
    onChange={(doc, text) => onChange({ modelAnswerDoc: doc, modelAnswer: text.trim() || undefined })} /></div>;
}

/** Several part editors may be preparing pictures at the same time. */
export function useModelAnswerImages() {
  const [pending, setPending] = useState<string[]>([]);
  const onBusyChange = useCallback((key: string, busy: boolean) => setPending((keys) => busy ? [...new Set([...keys, key])] : keys.filter((k) => k !== key)), []);
  return { addingImages: pending.length > 0, onBusyChange };
}
