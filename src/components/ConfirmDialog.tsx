import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  /** What will happen, in plain words. Lists and inputs are fine. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button; focus starts on Cancel so Enter cannot delete by accident. */
  destructive?: boolean;
  busy?: boolean;
  /** Disable the confirm button, for example until a required field is filled. */
  confirmDisabled?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * One modal confirmation for anything that removes or replaces data. Replaces the
 * browser's confirm() so the dialog can say exactly what goes, show an error in
 * place when the action fails, and keep the destructive button away from Enter.
 */
export default function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "Cancel", destructive, busy, confirmDisabled, error, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      if (destructive) cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, destructive]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={`confirm-dialog${destructive ? " destructive" : ""}`}
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
      onClick={(event) => { if (event.target === ref.current && !busy) onCancel(); }}
    >
      <form method="dialog" className="confirm-dialog-body" onSubmit={(event) => { event.preventDefault(); if (!busy && !confirmDisabled) onConfirm(); }}>
        <h2 id="confirm-dialog-title">{title}</h2>
        <div className="confirm-dialog-content">{children}</div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="confirm-dialog-actions">
          <button type="button" ref={cancelRef} onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="submit" className={destructive ? "danger-solid" : "primary"} disabled={busy || confirmDisabled} autoFocus={!destructive}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
