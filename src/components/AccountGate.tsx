import { useEffect, useRef } from "react";
import SignInPanel from "./SignInPanel";

interface Props {
  open: boolean;
  guestSubmitted: number;
  onClose: () => void;
}

/** Asked for once the free try is used up. Closing it keeps everything readable; starting new practice needs an account. */
export default function AccountGate({ open, guestSubmitted, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} className="confirm-dialog signin-dialog account-gate" aria-labelledby="account-gate-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="confirm-dialog-body">
        <div className="row spread"><h2 id="account-gate-title">Create a free account to keep going</h2><button type="button" className="small link" aria-label="Close" onClick={onClose}>×</button></div>
        <p className="muted signin-why">
          {guestSubmitted > 0 ? `You've answered ${guestSubmitted} ${guestSubmitted === 1 ? "question" : "questions"} as a guest. ` : ""}
          An account is free and takes a moment: Google, or an email address and password. Everything you've done on this device is kept and attached to it, and your work then follows you between devices.
        </p>
        <SignInPanel onDone={onClose} />
      </div>
    </dialog>
  );
}
