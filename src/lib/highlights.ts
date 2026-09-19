import type { Segment } from "./ambossMatch";

export interface Range {
  start: number;
  end: number;
}

/** Merge overlapping or touching ranges. */
export function normalise(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Toggle a selection: if it lies entirely within existing highlights the
 * overlapping part is removed, otherwise the selection is added.
 */
export function toggleRange(ranges: Range[], sel: Range): Range[] {
  const current = normalise(ranges);
  if (sel.end <= sel.start) return current;
  const covered = current.some((r) => r.start <= sel.start && r.end >= sel.end);
  if (!covered) return normalise([...current, sel]);
  const out: Range[] = [];
  for (const r of current) {
    if (r.end <= sel.start || r.start >= sel.end) {
      out.push(r);
      continue;
    }
    if (r.start < sel.start) out.push({ start: r.start, end: sel.start });
    if (r.end > sel.end) out.push({ start: sel.end, end: r.end });
  }
  return out;
}

export interface Piece extends Segment {
  hl?: boolean;
}

/** Split segments at highlight boundaries, marking highlighted pieces. */
export function splitByRanges(segments: Segment[], ranges: Range[]): Piece[] {
  const rs = normalise(ranges);
  if (rs.length === 0) return segments;
  const out: Piece[] = [];
  let pos = 0;
  for (const seg of segments) {
    const segStart = pos;
    const segEnd = pos + seg.text.length;
    const cuts = new Set<number>([segStart, segEnd]);
    for (const r of rs) {
      if (r.start > segStart && r.start < segEnd) cuts.add(r.start);
      if (r.end > segStart && r.end < segEnd) cuts.add(r.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const hl = rs.some((r) => r.start <= a && r.end >= b);
      out.push({ ...seg, text: seg.text.slice(a - segStart, b - segStart), hl });
    }
    pos = segEnd;
  }
  return out;
}

/** Character offsets of the current selection within a container, ignoring nodes matched by `ignore`. Browser only. */
export function selectionOffsets(container: HTMLElement, ignore = ".amboss-popup"): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest(ignore)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let offset = 0;
  let start = -1;
  let end = -1;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue?.length ?? 0;
    if (node === range.startContainer) start = offset + range.startOffset;
    if (node === range.endContainer) end = offset + range.endOffset;
    offset += len;
  }
  // Selection boundaries on element nodes: fall back to the whole text of the container side.
  if (start === -1 && range.startContainer === container) start = 0;
  if (end === -1 && range.endContainer === container) end = offset;
  if (start === -1 || end === -1 || end <= start) return null;
  return { start, end };
}
