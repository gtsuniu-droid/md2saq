import { useEffect, useState } from "react";
import AssistantMenu from "./AssistantMenu";
import type { SetForMarking } from "../lib/setForMarking";
import { markPrompt, setText } from "../lib/setForMarking";
import { keepForMarking } from "../lib/suggestedMarks";

interface Props { exam: SetForMarking; admin: boolean; signedIn: boolean }

/**
 * The whole exam paper handed over for marking in one go: copied as text, or (admins) marked by
 * their assistant through the connector, with the marks coming back to each set's marking page.
 */
export default function ExamMarking({ exam, admin, signedIn }: Props) {
  const [copied, setCopied] = useState(false);
  // Kept in the account's store as soon as the paper shows, so "mark the exam I just did" finds it without any prompt.
  const json = JSON.stringify(exam);
  useEffect(() => { if (signedIn) void keepForMarking(exam).catch(() => undefined); }, [signedIn, json]);
  const copy = () => { void navigator.clipboard.writeText(setText(exam)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  return <>
    <button type="button" className="small hl-btn" title="Copy the whole exam paper: every set, the questions, your answers and the model answers, to paste anywhere" onClick={copy}>{copied ? "Copied" : "Copy exam"}</button>
    {admin && signedIn && <AssistantMenu label="Mark exam with AI" title="Have your AI assistant mark the whole exam paper through the connector; the scores and comments come back to each set's marking page to check and save." prompt={markPrompt(exam)} hint="Your assistant reads the whole paper, marks every part and sends the scores and comments back. They fill in on each set's marking page." beforeOpen={() => keepForMarking(exam)} />}
  </>;
}
