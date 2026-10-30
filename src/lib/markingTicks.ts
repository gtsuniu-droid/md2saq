/**
 * A model answer as a tick list, when it is written one point per line with its mark in
 * square brackets ("- [1 mark] Stroke/TIA"), which is how the bank's sets are written. Lines
 * without a tag (MARKING, ACCEPTABLE ALTERNATIVES, DO NOT ACCEPT, Evidence) are guidance to
 * read, not points to tick. A model answer in any other shape gives no list, and shows as it is.
 */
export interface TickRow { index: number; text: string; marks: number }
export interface TickList { rows: TickRow[]; guidance: string[] }

const TAGGED = /^\s*(?:[-*•●◦▪]|\d{1,2}[.)])?\s*\[\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)?\s*\]\s*(.+?)\s*$/i;

export function tickList(modelAnswer: string | undefined): TickList | null {
  if (!modelAnswer) return null;
  const rows: TickRow[] = []; const guidance: string[] = [];
  modelAnswer.split(/\r?\n/).forEach((line, index) => {
    const m = TAGGED.exec(line);
    const marks = m ? Number(m[1]) : NaN;
    if (m && Number.isFinite(marks) && marks > 0 && marks <= 20) rows.push({ index, text: m[2], marks });
    else if (line.trim()) guidance.push(line.trim());
  });
  return rows.length >= 2 ? { rows, guidance } : null;
}

/** The score the ticked rows add up to, never more than the part's marks. */
export function tickedScore(list: TickList, ticked: number[], max: number): number {
  const sum = list.rows.filter((r) => ticked.includes(r.index)).reduce((t, r) => t + r.marks, 0);
  return Math.round(Math.min(max || Infinity, sum) * 100) / 100;
}
