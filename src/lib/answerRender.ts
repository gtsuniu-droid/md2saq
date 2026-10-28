import { generateHTML } from "@tiptap/react";
import DOMPurify from "dompurify";
import { EDITOR_EXTENSIONS } from "../components/Editor";

/** A saved answer as the page shows it. Its text is what comments' positions count in. */
export function renderAnswer(doc: unknown, text: string): HTMLDivElement {
  let html = "";
  try { if (doc && typeof doc === "object") html = generateHTML(doc as Parameters<typeof generateHTML>[0], EDITOR_EXTENSIONS); } catch { /* Legacy plain answer. */ }
  const container = document.createElement("div");
  if (html) container.innerHTML = DOMPurify.sanitize(html);
  else { const p = document.createElement("p"); p.className = "pre"; p.textContent = text || "No answer written."; container.append(p); }
  return container;
}
