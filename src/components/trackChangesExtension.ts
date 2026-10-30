import { Extension } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { changesBetween } from "../lib/trackChanges";

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
