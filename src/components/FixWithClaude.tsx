import { useEffect, useState } from "react";
import AssistantMenu from "./AssistantMenu";
import type { Question, QuestionSet } from "../data/types";
import { setLinkCode } from "../lib/shortSetLink";
import { setLabel } from "../lib/sets";
import { truncate } from "../lib/questions";

interface Props { set?: QuestionSet; question: Question; small?: boolean }

/**
 * Hand a bad question to an AI assistant on the spot. Opens Claude or ChatGPT with a
 * message that names the set by its code and the question by number, so the SAQ Practice
 * connector can read it, fix it and save it. The same text is copied for desktop clients.
 */
export default function FixWithClaude({ set, question, small = true }: Props) {
  const [code, setCode] = useState("");
  useEffect(() => { let live = true; if (set?.bankId) void setLinkCode(set.bankId).then((c) => { if (live) setCode(c); }); return () => { live = false; }; }, [set?.bankId]);
  if (!set?.bankId || !code) return null;
  const prompt = [
    `Using the SAQ Practice connector: set ${code} (${setLabel(set)}), question ${question.order + 1}.`,
    `It starts: "${truncate(question.text || question.parts[0]?.text || "", 160)}"`,
    "What is wrong with it: [describe the problem here]",
    "Read the set with getSet first, fix the question (and its model answer if that is the problem), show me the change, then save it with updateQuestion, updatePart or setAnswers.",
  ].join("\n");
  return <AssistantMenu label="Fix with AI" title="Hand this question to an AI assistant to fix. Needs your connection link from Settings, AI assistants." prompt={prompt} small={small}
    hint={`Names set ${code}, question ${question.order + 1}. Add what is wrong, and the assistant reads, fixes and saves it through the connector.`} />;
}
