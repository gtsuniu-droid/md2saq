import { Extension } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { changesBetween } from "../lib/trackChanges";
import { withParagraphBreaks, type AnswerAnchor } from "../lib/answerComments";
import { diffWithOrigin } from "../lib/wordDiff";

/**
 * Tracked changes, as a word processor shows them: the editor's text is compared with the
 * answer as it was submitted on every change, added words are underlined and removed words
 * stay in view struck through where they were. Nothing is stored in the document itself, so
 * the revision saves as ordinary content and the markup can be hidden.
 */
export const trackChangesKey = new PluginKey<{ shown: boolean }>("trackChanges");

/** The document's plain text, and the editor position of each character (plus the end), so word ranges can be placed. */
export function plainWithPositions(doc: PMNode): { text: string; positions: number[] } {
  let text = ""; const positions: number[] = []; let blocks = 0;
  doc.descendants((node, pos) => {
    if (node.isTextblock) { if (blocks++) { text += "\n"; positions.push(pos); } }
    if (node.isText && node.text) { for (let i = 0; i < node.text.length; i++) positions.push(pos + i); text += node.text; }
    return true;
  });
  positions.push(doc.content.size);
  return { text, positions };
}

export interface TrackChangesOptions { original: unknown; originalText: string }

export const TrackChanges = Extension.create<TrackChangesOptions>({
  name: "trackChanges",
  addOptions() { return { original: null, originalText: "" }; },
  addProseMirrorPlugins() {
    let original = this.options.originalText;
    try { if (this.options.original && typeof this.options.original === "object") original = plainWithPositions(PMNode.fromJSON(this.editor.schema, this.options.original)).text; } catch { /* a plain answer */ }
    let last: { doc: PMNode; shown: boolean; set: DecorationSet } | null = null;
    return [new Plugin({
      key: trackChangesKey,
      state: {
        init: () => ({ shown: true }),
        apply: (tr, value) => { const meta = tr.getMeta(trackChangesKey) as { shown?: boolean } | undefined; return meta ? { ...value, ...meta } : value; },
      },
      props: {
        decorations(state) {
          const { shown } = trackChangesKey.getState(state) ?? { shown: true };
          if (!shown) return DecorationSet.empty;
          if (last && last.doc.eq(state.doc) && last.shown === shown) return last.set;
          const { text, positions } = plainWithPositions(state.doc);
          const changes = changesBetween(original, text, positions);
          const set = DecorationSet.create(state.doc, [
            ...changes.inserted.map((r) => Decoration.inline(r.from, r.to, { class: "tc-ins" })),
            ...changes.deleted.map((d) => Decoration.widget(d.at, () => { const el = document.createElement("del"); el.className = "tc-del"; el.textContent = d.text; return el; }, { side: -1, key: `${d.at}:${d.text}` })),
          ]);
          last = { doc: state.doc, shown, set };
          return set;
        },
      },
    })];
  },
});

/**
 * The margin comments' highlights inside the editor: each comment was made on a passage of
 * the answer as submitted, and stays on those words while they remain, moving with them as
 * the text around them changes. Words that were removed carry no highlight (they show struck).
 */
type Highlighted = { comments: (AnswerAnchor & { id: string })[]; active: string | null };
export const commentHighlightsKey = new PluginKey<Highlighted>("commentHighlights");

export const CommentHighlights = Extension.create<TrackChangesOptions>({
  name: "commentHighlights",
  addOptions() { return { original: null, originalText: "" }; },
  addProseMirrorPlugins() {
    // The original's paragraphs: comment positions count them run together, the diff reads them with line breaks.
    let paragraphs = [this.options.originalText];
    try {
      if (this.options.original && typeof this.options.original === "object") {
        const blocks: string[] = []; PMNode.fromJSON(this.editor.schema, this.options.original).descendants((node) => { if (node.isTextblock) blocks.push(node.textContent); return !node.isTextblock; });
        paragraphs = blocks;
      }
    } catch { /* a plain answer */ }
    const original = paragraphs.join("\n");
    return [new Plugin({
      key: commentHighlightsKey,
      state: {
        init: (): Highlighted => ({ comments: [], active: null }),
        apply: (tr, value: Highlighted): Highlighted => { const meta = tr.getMeta(commentHighlightsKey) as Partial<Highlighted> | undefined; return meta ? { ...value, ...meta } : value; },
      },
      props: {
        decorations(state) {
          const { comments, active } = commentHighlightsKey.getState(state) ?? { comments: [], active: null };
          if (!comments.length) return DecorationSet.empty;
          const { text, positions } = plainWithPositions(state.doc);
          // Kept text, with where it sits in the original (with breaks) and in the current text.
          let current = 0; const kept: { at: number; cur: number; len: number }[] = [];
          for (const part of diffWithOrigin(original, text)) {
            if (part.kind === "same" && part.at !== undefined) kept.push({ at: part.at, cur: current, len: part.text.length });
            if (part.kind !== "del") current += part.text.length;
          }
          // Each comment's passage, as a range of the current text's offsets.
          const ranges: { from: number; to: number; id: string }[] = [];
          for (const c of comments) {
            const start = withParagraphBreaks(paragraphs, c.start, "start"); const end = withParagraphBreaks(paragraphs, c.end, "end");
            for (const k of kept) {
              const from = Math.max(start, k.at); const to = Math.min(end, k.at + k.len);
              if (to > from) ranges.push({ from: k.cur + (from - k.at), to: k.cur + (to - k.at), id: c.id });
            }
          }
          // Split at every boundary, so passages that share words carry every comment on them (one span per stretch, as the page does).
          const cuts = [...new Set(ranges.flatMap((r) => [r.from, r.to]))].sort((a, b) => a - b);
          const decorations: Decoration[] = [];
          for (let i = 0; i + 1 < cuts.length; i++) {
            const from = cuts[i]; const to = cuts[i + 1];
            const ids = ranges.filter((r) => r.from < to && r.to > from).map((r) => r.id);
            if (!ids.length) continue;
            const a = positions[from]; const b = positions[to - 1];
            if (a === undefined || b === undefined) continue;
            decorations.push(Decoration.inline(a, b + 1, { class: "answer-comment-highlight" + (ids.includes(active ?? "") ? " active" : ""), "data-comment-ids": JSON.stringify(ids), role: "button", tabindex: "0" }));
          }
          return DecorationSet.create(state.doc, decorations);
        },
      },
    })];
  },
});
