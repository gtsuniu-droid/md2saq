import { PRESENTATIONS } from "../data/presentations";
import type { SubPart } from "../data/types";
import { markingPoints } from "./marking";
import { SEP } from "./tree";

interface QuestionLike {
  text: string;
  modelAnswer?: string;
  parts: SubPart[];
}

/** Only questions that ask for diagnoses feed suggestions; "explain" questions produce reasoning, not names. */
const DIAGNOSIS_CUE = /\b(list|state|name|give|identify|suggest|what|which)\b[^.?]*\b(diagnos\w*|differentials?|causes?|conditions?)\b|\bmost likely diagnos|\baccount for\b/i;
const STOP = /\b(and|or|the|with|for|each|state|give|list|name|history|examination|interpretation|mechanism|feature|features|finding|findings|marks?|accept|award|answer|other|acceptable|differentials?|when|justified|consider|note|if|because|may|should|would|patient)\b/i;

/** Clean a marking point down to the condition it names, or null. */
function conditionFrom(point: string): string | null {
  let t = point
    .replace(/^\s*(?:[-*•●◦▪]|\d{1,2}[.)]|\(?[a-z]\)|[ivx]{1,4}[.)])\s*/i, "")
    .replace(/^\s*\[\d+(?:\.\d+)?\s*marks?\]\s*/i, "")
    .trim();
  t = t.split(/\s*(?::|–|—| - |\(|;|,)\s*/)[0].trim();
  t = t.replace(/[.:]+$/, "").trim();
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 5) return null;
  if (t.length < 4 || t.length > 45) return null;
  if (!/^[A-Z]/.test(t)) return null;
  if (/\d/.test(t) && !/\b(type|grade|stage)\b/i.test(t)) return null;
  if (STOP.test(t)) return null;
  return t;
}

/** Likely conditions covered by a set, read from the model answers of diagnosis-style questions. */
export function suggestConditionTags(questions: QuestionLike[], limit = 8): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const q of questions) {
    const sources: string[] = [];
    if (q.modelAnswer && DIAGNOSIS_CUE.test(q.text)) sources.push(q.modelAnswer);
    for (const p of q.parts) if (p.modelAnswer && DIAGNOSIS_CUE.test(p.text)) sources.push(p.modelAnswer);
    for (const src of sources) {
      for (const point of markingPoints(src)) {
        const c = conditionFrom(point);
        if (!c) continue;
        const key = c.toLowerCase();
        const cur = counts.get(key) ?? { label: c, n: 0 };
        cur.n++;
        counts.set(key, cur);
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, limit).map((x) => x.label);
}

/** Everything a tag box can autocomplete from: existing tags, branch paths, and presentation names. */
export function knownTags(existing: string[]): string[] {
  const out = new Set<string>();
  for (const t of existing) {
    out.add(t);
    // Each prefix of a nested tag is a branch worth offering.
    const parts = t.split(SEP);
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join(SEP));
  }
  for (const p of PRESENTATIONS) out.add(p.name);
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
