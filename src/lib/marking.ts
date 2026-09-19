/** Split a model answer into individual marking points. */
export function markingPoints(modelAnswer: string): string[] {
  const lines = modelAnswer
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•●◦▪]|\d{1,2}[.)]|\(?[a-z]\)|[ivx]{1,4}[.)])\s*/i, "").trim())
    .filter((l) => l.length > 0);
  if (lines.length > 1) return lines;
  const single = lines[0] ?? "";
  const bySemicolon = single.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
  if (bySemicolon.length > 1) return bySemicolon;
  const sentences = single.split(/(?<=[.])\s+(?=[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);
  return sentences.length > 0 ? sentences : [];
}

const STOPWORDS = new Set([
  "the", "and", "with", "that", "this", "from", "have", "will", "would", "should", "could",
  "there", "their", "which", "about", "into", "than", "then", "them", "they", "been", "being",
  "also", "such", "when", "what", "where", "were", "your", "patient", "patients", "history",
  "examination", "including", "consider", "cause", "causes", "other", "over", "under", "more",
  "most", "some", "each", "both", "after", "before", "because", "these", "those", "does", "done",
]);

/** Significant terms from the marking points, for hit highlighting. */
export function keyTerms(points: string[]): string[] {
  const terms = new Set<string>();
  for (const p of points) {
    for (const w of p.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 4 && !STOPWORDS.has(w)) terms.add(w);
    }
  }
  return [...terms];
}

/** Terms that appear in the answer. */
export function hitTerms(answerText: string, points: string[]): string[] {
  const hay = answerText.toLowerCase();
  return keyTerms(points).filter((t) => new RegExp(`\\b${t}`, "i").test(hay));
}

/** Wrap hit terms in <mark class="hit"> inside HTML text nodes. Browser only. */
export function highlightHtml(html: string, terms: string[]): string {
  if (terms.length === 0 || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, "text/html");
  const root = doc.getElementById("r");
  if (!root) return html;
  const re = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\w*`, "gi");
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);
  for (const node of textNodes) {
    const value = node.nodeValue ?? "";
    if (!re.test(value)) continue;
    re.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      frag.appendChild(doc.createTextNode(value.slice(last, m.index)));
      const mark = doc.createElement("mark");
      mark.className = "hit";
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
    }
    frag.appendChild(doc.createTextNode(value.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
  return root.innerHTML;
}
