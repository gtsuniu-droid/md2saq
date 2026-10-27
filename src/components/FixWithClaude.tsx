import { useEffect, useState } from "react";
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
  const [note, setNote] = useState("");
  useEffect(() => { let live = true; if (set?.bankId) void setLinkCode(set.bankId).then((c) => { if (live) setCode(c); }); return () => { live = false; }; }, [set?.bankId]);
  if (!set?.bankId || !code) return null;
  const prompt = [
    `Using the SAQ Practice connector: set ${code} (${setLabel(set)}), question ${question.order + 1}.`,
    `It starts: "${truncate(question.text || question.parts[0]?.text || "", 160)}"`,
    "What is wrong with it: [describe the problem here]",
    "Read the set with getSet first, fix the question (and its model answer if that is the problem), show me the change, then save it with updateQuestion, updatePart or setAnswers.",
  ].join("\n");
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setNote("Copied"); setTimeout(() => setNote(""), 1500); } catch { setNote("Could not copy"); }
  };
  const open = async (url: string) => { await copy(); window.open(url, "_blank", "noopener"); };
  return <details className="fix-with-ai">
    <summary className={small ? "small" : undefined} title="Hand this question to an AI assistant to fix. Needs your connection link from Settings, AI assistants.">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z" fill="currentColor" /></svg>
      Fix with AI{note && <span className="muted">, {note}</span>}
    </summary>
    <div className="fix-with-ai-menu">
      <button type="button" className="small" onClick={() => void open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`)}>Open in Claude</button>
      <button type="button" className="small" onClick={() => void open(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`)}>Open in ChatGPT</button>
      <button type="button" className="small link" onClick={() => void copy()}>Copy the prompt</button>
      <small className="muted">Names set {code}, question {question.order + 1}. Add what is wrong, and the assistant reads, fixes and saves it through the connector.</small>
    </div>
  </details>;
}
