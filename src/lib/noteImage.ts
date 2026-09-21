import Image from "@tiptap/extension-image";

/** Keep the resize preview in step with undo, reset and edits from another window. */
export const NoteImage = Image.extend({
  addNodeView() {
    const render = this.parent?.();
    if (!render) return null;
    return (props) => {
      const view = render(props);
      const update = view.update?.bind(view);
      view.update = (node, decorations, innerDecorations) => {
        const accepted = update?.(node, decorations, innerDecorations) ?? true;
        const image = (view.dom as HTMLElement).querySelector("img");
        if (accepted && image) {
          image.style.width = Number(node.attrs.width) > 0 ? `${Number(node.attrs.width)}px` : "";
          image.style.height = Number(node.attrs.height) > 0 ? `${Number(node.attrs.height)}px` : "";
        }
        return accepted;
      };
      return view;
    };
  },
});
