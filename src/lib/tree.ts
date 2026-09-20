import { PRESENTATIONS, presentationName } from "../data/presentations";
import { setLabel, type SetSummary } from "./sets";

/**
 * Anki-style deck tree. A set's place comes from its hierarchical tags
 * ("Dizziness::Vestibular") when it has any, otherwise from its dominant
 * presentation, so every set lands under a presentation by default. A set
 * may appear under several branches if it carries several :: tags.
 */

export interface TreeNode {
  /** Full path, e.g. "Dizziness::Vestibular". */
  path: string;
  /** Raw segment as tagged, e.g. "13_Cranial_Nerves_1-6". */
  name: string;
  /** Segment for display: underscores become spaces, as Anki shows them. */
  label: string;
  emoji?: string;
  children: TreeNode[];
  sets: SetSummary[];
  /** Totals for the whole branch. */
  questions: number;
  attempted: number;
  marked: number;
  sittings: number;
}

export const SEP = "::";

export function displayName(segment: string): string {
  return segment.replace(/_/g, " ").trim();
}

function emojiFor(name: string): string | undefined {
  return PRESENTATIONS.find((p) => p.name.toLowerCase() === name.toLowerCase())?.emoji;
}

/** Paths a set belongs under. */
export function setPaths(s: SetSummary): string[] {
  const explicit = (s.set.tags ?? []).filter((t) => t.includes(SEP)).map((t) => t.split(SEP).map((x) => x.trim()).filter(Boolean).join(SEP));
  if (explicit.length) return [...new Set(explicit)];
  const top = s.presentations[0];
  return [top ? presentationName(top) : "Untagged"];
}

export function buildTree(summaries: SetSummary[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const ensure = (parts: string[]): TreeNode => {
    let level = roots;
    let path = "";
    let node: TreeNode | undefined;
    for (const part of parts) {
      path = path ? `${path}${SEP}${part}` : part;
      node = level.find((n) => n.name.toLowerCase() === part.toLowerCase());
      if (!node) {
        node = { path, name: part, label: displayName(part), emoji: emojiFor(displayName(part)), children: [], sets: [], questions: 0, attempted: 0, marked: 0, sittings: 0 };
        level.push(node);
      }
      level = node.children;
    }
    return node!;
  };
  for (const s of summaries) {
    for (const p of setPaths(s)) ensure(p.split(SEP)).sets.push(s);
  }
  const total = (n: TreeNode): void => {
    n.children.forEach(total);
    const branch = setsInBranch(n);
    n.questions = branch.reduce((a, s) => a + s.questions.length, 0);
    n.attempted = branch.reduce((a, s) => a + s.attemptedQuestions, 0);
    n.marked = branch.reduce((a, s) => a + s.markedQuestions, 0);
    n.sittings = branch.reduce((a, s) => a + s.sittings.length, 0);
    n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    n.sets.sort((a, b) => (a.set.number ?? 0) - (b.set.number ?? 0));
  };
  roots.forEach(total);
  roots.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return roots;
}

/** Every set in a branch, once each. */
export function setsInBranch(node: TreeNode): SetSummary[] {
  const seen = new Set<string>();
  const out: SetSummary[] = [];
  const walk = (n: TreeNode) => {
    for (const s of n.sets) if (!seen.has(s.set.id)) { seen.add(s.set.id); out.push(s); }
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

export interface QuestionHit {
  questionId: string;
  /** 1-based question number in the set. */
  number: number;
  /** Where in the question the text was found. */
  field: "stem" | "question" | "part" | "model answer";
  /** A window of text around the first match. */
  snippet: string;
}

export interface SetHits {
  /** Matching tags, as written. */
  tags: string[];
  /** Whether the set's label, name or source matched. */
  label: boolean;
  questions: QuestionHit[];
}

const SNIPPET = 70;

/** A window of text around the first match, with ellipses where it was cut. */
export function snippetAround(text: string, needle: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(needle);
  if (at < 0) return null;
  const start = Math.max(0, at - SNIPPET);
  const end = Math.min(flat.length, at + needle.length + SNIPPET);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

/** Everything in a set that contains the search text: tags, label, and each question's content. */
export function searchHits(s: SetSummary, q: string): SetHits | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  const tags = (s.set.tags ?? []).filter((t) => t.toLowerCase().includes(needle));
  const label = [setLabel(s.set), s.set.name, s.set.source ?? ""].join(" ").toLowerCase().includes(needle);
  const questions: QuestionHit[] = [];
  for (const x of s.questions) {
    const fields: [QuestionHit["field"], string][] = [
      ...(x.stems ?? []).map((st): [QuestionHit["field"], string] => ["stem", st]),
      ["question", x.text],
      ...x.parts.map((p): [QuestionHit["field"], string] => ["part", `(${p.label}) ${p.text}`]),
      ["model answer", [x.modelAnswer ?? "", ...x.parts.map((p) => p.modelAnswer ?? "")].join(" ")],
    ];
    for (const [field, text] of fields) {
      const snippet = snippetAround(text, needle);
      if (snippet) {
        questions.push({ questionId: x.id, number: x.order + 1, field, snippet });
        break;
      }
    }
  }
  if (tags.length === 0 && !label && questions.length === 0) return null;
  return { tags, label, questions };
}

/** Filter the tree to nodes or sets matching a search string. */
export function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return nodes;
  const walk = (n: TreeNode): TreeNode | null => {
    const children = n.children.map(walk).filter((c): c is TreeNode => !!c);
    const sets = n.label.toLowerCase().includes(needle) ? n.sets : n.sets.filter((s) => searchHits(s, q) !== null);
    if (children.length === 0 && sets.length === 0) return null;
    return { ...n, children, sets };
  };
  return nodes.map(walk).filter((n): n is TreeNode => !!n);
}

/** "Dizziness – Set 3": the set's first branch and its number, for lists outside the tree. */
export function fullLabel(s: SetSummary): string {
  const top = setPaths(s)[0]?.split(SEP).map(displayName).join(" / ");
  const num = setLabel(s.set);
  return top ? `${top} – ${num}` : num;
}
