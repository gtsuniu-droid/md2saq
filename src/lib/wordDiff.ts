/**
 * A word-level difference between two texts, for showing a student's answer rewritten for
 * full marks in place: what they wrote that earned nothing struck through, what would have
 * earned the mark added. Pure; the longest common subsequence over words.
 */
export type DiffPart = { kind: "same" | "del" | "ins"; text: string };

/** Words with the whitespace that follows each, so the text rebuilds exactly from the parts. */
const tokens = (s: string): string[] => s.match(/^\s+|\S+\s*/g) ?? [];
const word = (t: string) => t.trim().toLowerCase();

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before); const b = tokens(after);
  const n = a.length; const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = word(a[i]) === word(b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text; else out.push({ kind, text });
  };
  let i = 0; let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && word(a[i]) === word(b[j])) { push("same", b[j]); i++; j++; }
    else if (i < n && (j >= m || table[i + 1][j] >= table[i][j + 1])) { push("del", a[i]); i++; }
    else { push("ins", b[j]); j++; }
  }
  // A short word that happens to match between two changes ("and", "of") would split one
  // change into two for nothing: it is treated as changed, and each cluster of changes reads
  // as one deletion then one insertion.
  const clustered: DiffPart[] = [];
  let dels = ""; let inss = "";
  const flush = () => { if (dels) clustered.push({ kind: "del", text: dels }); if (inss) clustered.push({ kind: "ins", text: inss }); dels = ""; inss = ""; };
  out.forEach((p, i) => {
    const between = p.kind === "same" && p.text.trim().length < 4 && i > 0 && i < out.length - 1 && out[i - 1].kind !== "same" && out[i + 1].kind !== "same";
    if (p.kind === "same" && !between) { flush(); clustered.push(p); return; }
    if (p.kind === "same") { dels += p.text; inss += p.text; return; }
    if (p.kind === "del") dels += p.text; else inss += p.text;
  });
  flush();
  // Whitespace at the end of an insertion is not part of it. A deletion keeps its trailing
  // whitespace (struck through, it is invisible): the parts other than deletions must rebuild
  // the current text exactly, since positions in it are counted from them.
  return clustered.flatMap((p) => {
    if (p.kind !== "ins") return [p];
    const trimmed = p.text.replace(/\s+$/, "");
    const tail = p.text.slice(trimmed.length);
    return [...(trimmed ? [{ kind: p.kind, text: trimmed }] : []), ...(tail ? [{ kind: "same" as const, text: tail }] : [])];
  }).reduce<DiffPart[]>((acc, p) => { const last = acc[acc.length - 1]; if (last && last.kind === p.kind) last.text += p.text; else acc.push({ ...p }); return acc; }, []);
}

/** The parts with, for text that was in the original (kept or removed), its offset there. */
export function diffWithOrigin(before: string, after: string): (DiffPart & { at?: number })[] {
  let at = 0;
  return wordDiff(before, after).flatMap((p) => {
    if (p.kind === "ins") return [p];
    if (before.startsWith(p.text, at)) { const part = { ...p, at }; at += p.text.length; return [part]; }
    // Whitespace left over from an insertion runs into the kept text that follows: it is not in the original.
    const lead = p.text.length - p.text.trimStart().length;
    const rest = p.text.slice(lead);
    if (lead && rest && before.startsWith(rest, at)) { const part = { ...p, text: rest, at }; at += rest.length; return [{ kind: p.kind, text: p.text.slice(0, lead) }, part]; }
    return [p];
  });
}
