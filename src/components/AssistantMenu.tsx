import { useState } from "react";

interface Props { label: string; title: string; prompt: string; hint: string; small?: boolean; beforeOpen?: () => Promise<unknown> }

/**
 * Hand a task to an AI assistant on the spot: opens Claude or ChatGPT with a message the SAQ
 * Practice connector can act on. The same text is copied for desktop clients.
 */
export default function AssistantMenu({ label, title, prompt, hint, small = true, beforeOpen }: Props) {
  const [note, setNote] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setNote("Copied"); setTimeout(() => setNote(""), 1500); } catch { setNote("Could not copy"); }
  };
  const open = async (url: string) => { await beforeOpen?.().catch(() => undefined); await copy(); window.open(url, "_blank", "noopener"); };
  return <details className="fix-with-ai">
    <summary className={small ? "small" : undefined} title={title}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z" fill="currentColor" /></svg>
      {label}{note && <span className="muted">, {note}</span>}
    </summary>
    <div className="fix-with-ai-menu">
      <button type="button" className="small" onClick={() => void open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`)}>Open in Claude</button>
      <button type="button" className="small" onClick={() => void open(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`)}>Open in ChatGPT</button>
      <button type="button" className="small link" onClick={() => void copy()}>Copy the prompt</button>
      <small className="muted">{hint}</small>
    </div>
  </details>;
}
