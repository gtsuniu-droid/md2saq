import { answerDocument, type ModelAnswer } from "../lib/modelAnswer";
import { NoteContent, NoteReadingControls, useNoteReadingSize } from "./NoteReading";
import { useMemo } from "react";

export default function ModelAnswerContent({ answer }: { answer: ModelAnswer }) {
  const [size, setSize] = useNoteReadingSize();
  const doc = useMemo(() => answerDocument(answer), [answer.modelAnswerDoc, answer.modelAnswer]);
  return <div className="model-answer-content">
    <NoteReadingControls size={size} onChange={setSize} />
    <NoteContent doc={doc} size={size} />
  </div>;
}
