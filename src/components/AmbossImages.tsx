import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import type { AmbossMedia } from "../data/types";

function ReferenceImage({ media, title, enlarge }: { media: AmbossMedia; title: string; enlarge?: () => void }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const caption = media.title || title;
  return <figure className="amboss-reference-image">
    {failed ? <div className="amboss-image-error" role="status"><p>This picture could not load.</p><button type="button" className="small" onClick={() => { setFailed(false); setRetry((n) => n + 1); }}>Retry picture</button></div> : enlarge ?
      <button type="button" className="amboss-image-preview" aria-label={`Enlarge ${caption}`} onClick={enlarge}>
        <img key={retry} src={media.canonicalUrl!} alt={caption} loading="lazy" onError={() => setFailed(true)} />
        <span>Click picture to enlarge</span>
      </button> : <img key={retry} src={media.canonicalUrl!} alt={caption} onError={() => setFailed(true)} />}
    {media.title && <figcaption>{media.title}</figcaption>}
    {media.copyright?.html && <div className="amboss-image-credit muted" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(media.copyright.html, { ADD_ATTR: ["target"] }) }} />}
  </figure>;
}

function ImageViewer({ media, title, initial, onClose }: { media: AmbossMedia[]; title: string; initial: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initial);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="amboss-image-viewer" aria-label="Enlarged AMBOSS image"
    onCancel={(e) => { e.preventDefault(); onClose(); }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    onKeyDown={(e) => {
      // Escape closes the picture while leaving the reference pane open.
      if (e.key === "Escape") e.stopPropagation();
      if (e.key === "ArrowLeft") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
      if (e.key === "ArrowRight") { e.preventDefault(); setIndex((i) => Math.min(media.length - 1, i + 1)); }
    }}>
    <div className="amboss-image-viewer-content">
      <header className="row spread"><strong>{title}</strong><button type="button" className="small" onClick={onClose} aria-label="Close enlarged picture" autoFocus>×</button></header>
      <ReferenceImage key={media[index].eid} media={media[index]} title={title} />
      {media.length > 1 && <nav className="row spread" aria-label="Image navigation"><button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Previous</button><span aria-live="polite">{index + 1} / {media.length}</span><button type="button" disabled={index === media.length - 1} onClick={() => setIndex(index + 1)}>Next →</button></nav>}
    </div>
  </dialog>, document.body);
}

/** Pictures supplied with a term appear beside its explanation, just like Anki. */
export default function AmbossImages({ media, title, preview = false, onViewAll, onViewerChange }: { media: AmbossMedia[]; title: string; preview?: boolean; onViewAll?: () => void; onViewerChange?: (open: boolean) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => { onViewerChange?.(selected !== null); return () => onViewerChange?.(false); }, [selected, onViewerChange]);
  if (!media.length) return null;
  return <div className="amboss-images">
    {(preview ? media.slice(0, 1) : media).map((item, index) => <ReferenceImage key={item.eid} media={item} title={title} enlarge={() => setSelected(index)} />)}
    {preview && media.length > 1 && <button type="button" className="small amboss-view-images" onClick={onViewAll}>View all {media.length} pictures</button>}
    {selected !== null && <ImageViewer media={media} title={title} initial={selected} onClose={() => setSelected(null)} />}
  </div>;
}
