import { useRef, useState, type DragEvent as ReactDragEvent } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import type { Slice } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { compressImage } from "../lib/images";
import { hasFileTransfer, imageTransferFiles } from "../lib/imageTransfer";

/** Shared clipboard/drop handling for notes, model answers and practice answers. */
export function useEditorImages(onBusyChange?: (busy: boolean) => void) {
  const editorRef = useRef<Editor | null>(null);
  const pending = useRef(0);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const [addingImages, setAddingImages] = useState(false);
  const [draggingImages, setDraggingImages] = useState(false);
  const [error, setError] = useState("");

  async function addImages(files: File[], dropPosition?: number) {
    const target = editorRef.current;
    if (!target || !target.isEditable || !files.length) return;
    let position = dropPosition ?? target.state.selection.from;
    const mapPosition = ({ transaction }: { transaction: Transaction }) => { position = transaction.mapping.map(position); };
    target.on("transaction", mapPosition);
    pending.current++;
    setAddingImages(true); busyCallback.current?.(true);
    try {
      const images: JSONContent[] = [];
      for (const file of files) images.push({ type: "image", attrs: { src: await compressImage(file, 1100), alt: file.name || "Pasted picture" } });
      if (target.isDestroyed) return;
      target.chain().focus().insertContentAt(position, images).run();
      setError("");
    } catch { setError("That picture could not be added. Try a PNG or JPEG."); }
    finally {
      target.off("transaction", mapPosition);
      if (--pending.current === 0) { setAddingImages(false); busyCallback.current?.(false); }
    }
  }

  const handleDrop = (view: EditorView, event: DragEvent, moved = false) => {
    // Preserve native editor movement of existing images and text.
    if (moved || !hasFileTransfer(event.dataTransfer)) return false;
    event.preventDefault();
    setDraggingImages(false);
    const files = imageTransferFiles(event.dataTransfer);
    if (!editorRef.current?.isEditable) return true;
    if (files.length) void addImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
    else setError("Drop a picture file such as PNG or JPEG here.");
    return true;
  };

  return {
    editorRef, addingImages, draggingImages, error, addImages,
    editorProps: {
      handlePaste: (_view: EditorView, event: ClipboardEvent) => {
        const files = imageTransferFiles(event.clipboardData);
        if (!files.length) return false;
        event.preventDefault();
        void addImages(files);
        return true;
      },
      handleDrop: (view: EditorView, event: DragEvent, _slice: Slice, moved: boolean) => handleDrop(view, event, moved),
    },
    dropProps: {
      onDragStart: (event: ReactDragEvent<HTMLDivElement>) => event.stopPropagation(),
      onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
        if (!hasFileTransfer(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = editorRef.current?.isEditable ? "copy" : "none";
        setDraggingImages(!!editorRef.current?.isEditable);
      },
      onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDraggingImages(false);
      },
      onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
        setDraggingImages(false);
        if (!hasFileTransfer(event.dataTransfer)) return;
        // The inner ProseMirror handler owns content-area drops; this catches toolbar/padding drops once.
        event.stopPropagation();
        if (event.defaultPrevented) return;
        event.preventDefault();
        const target = editorRef.current;
        if (target) handleDrop(target.view, event.nativeEvent);
      },
    },
  };
}
