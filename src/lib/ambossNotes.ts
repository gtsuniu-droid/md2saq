import type { JSONContent } from "@tiptap/react";
import { markTerms, type Term } from "./ambossMatch";

export function noteLookupText(node: JSONContent): string {
  if (node.type === "hardBreak") return "\n";
  if (node.type === "text") return node.text ?? "";
  const separator = ["doc", "table", "tableRow", "bulletList", "orderedList", "listItem", "tableCell", "tableHeader", "blockquote"].includes(node.type ?? "") ? "\n" : "";
  return (node.content ?? []).map(noteLookupText).join(separator);
}

/** Notes may be edited; a content fingerprint prevents stale phrase results. */
export function ambossTextFingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

/** Add interactive terms to already-sanitized rich text, retaining tables and formatting. */
export function annotateAmbossHtml(html: string, terms: Term[]): string {
  if (!terms.length) return html;
  const root = document.createElement("div");
  root.innerHTML = html;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    if (!text.parentElement?.closest("a, button, code, pre, script, style")) texts.push(text);
  }
  for (const node of texts) {
    const segments = markTerms(node.data, terms);
    if (!segments.some((s) => s.pgId)) continue;
    const fragment = document.createDocumentFragment();
    for (const segment of segments) {
      if (!segment.pgId) { fragment.append(document.createTextNode(segment.text)); continue; }
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "amboss-marker amboss-note-term";
      marker.dataset.phraseId = segment.pgId;
      marker.dataset.phraseTerm = segment.term;
      marker.setAttribute("aria-label", `${segment.term}: open AMBOSS reference`);
      marker.textContent = segment.text;
      fragment.append(marker);
    }
    node.replaceWith(fragment);
  }
  return root.innerHTML;
}
