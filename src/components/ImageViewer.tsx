import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Pictures in questions, stems, answers, model answers and notes. */
export const ZOOMABLE = ":is(.qimg, .note-rich, .answer-html, .commented-answer, .model-answer-content, .browse-reading) img";
/** Not pictures being edited, links and buttons, or AMBOSS images, which open in their own viewer. */
const LEFT_ALONE = "[contenteditable='true'], a, button, .amboss-media, .amboss-reference-image, .image-viewer";

/**
 * Click a picture to see it large over the page; click anywhere around it, the close button,
 * or press Escape to go back. One listener for the whole app, so pictures inside rendered
 * documents work too, wherever they appear.
 */
export default function ImageViewer() {
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const img = e.target instanceof HTMLImageElement ? e.target : null;
      if (!img || !img.matches(ZOOMABLE) || img.closest(LEFT_ALONE)) return;
      e.preventDefault();
      setImage({ src: img.currentSrc || img.src, alt: img.alt });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!image) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setImage(null); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; back?.focus(); };
  }, [image]);

  if (!image) return null;
  return createPortal(<div className="image-viewer" role="dialog" aria-modal="true" aria-label={image.alt || "Enlarged picture"} onClick={() => setImage(null)}>
    <img src={image.src} alt={image.alt} onClick={(e) => e.stopPropagation()} />
    <button ref={close} type="button" className="image-viewer-close" aria-label="Close picture" onClick={() => setImage(null)}>×</button>
  </div>, document.body);
}
