import { useEffect, useRef, useState } from "react";
import type { Session } from "../data/types";
import { formatClock } from "../lib/questions";
import { overtimeSec, readingRemainingSec, remainingSec, setOvertimeSec, setRemainingSec, shouldAutoSubmit, usesSetClock } from "../lib/sessionClock";

/**
 * The paper's clock, ticking on its own so the rest of the paper (editors, case stem, sidebar)
 * is not re-rendered every second. The paper itself only needs to know which phase it is in.
 */
export interface ClockPhase { reading: boolean; expired: boolean; examExpired: boolean }

function phaseOf(session: Session | null, clockKey: string | undefined, now: number): ClockPhase {
  if (!session) return { reading: false, expired: false, examExpired: false };
  const remaining = usesSetClock(session, clockKey) ? setRemainingSec(session, clockKey!, now) : remainingSec(session, now);
  return { reading: readingRemainingSec(session, now) > 0, expired: remaining !== null && remaining <= 0, examExpired: shouldAutoSubmit(session, now) };
}

/** Reading, writing, over time: re-renders the caller only when the phase changes. */
export function useClockPhase(session: Session | null, clockKey: string | undefined): ClockPhase {
  const [phase, setPhase] = useState(() => phaseOf(session, clockKey, Date.now()));
  useEffect(() => {
    const tick = () => {
      const next = phaseOf(session, clockKey, Date.now());
      setPhase((p) => p.reading === next.reading && p.expired === next.expired && p.examExpired === next.examExpired ? p : next);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session, clockKey]);
  return phase;
}

interface Props {
  session: Session;
  clockKey: string | undefined;
  /** Practice papers let the student set a timer for the set they are on; exams do not. */
  onSetTimer?: (minutes: number) => void;
  onClearTimer?: () => void;
}

export default function PaperClock({ session, clockKey, onSetTimer, onClearTimer }: Props) {
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState("");
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const perSet = usesSetClock(session, clockKey);
  const clock = clockKey ? session.setClocks?.[clockKey] : undefined;
  const manual = perSet && !!clock?.manual;
  const remaining = perSet ? setRemainingSec(session, clockKey!, now) : remainingSec(session, now);
  const readingLeft = readingRemainingSec(session, now);
  const reading = readingLeft > 0;
  const displayed = reading ? readingLeft : remaining;
  const expired = remaining !== null && remaining <= 0;
  const overtime = perSet ? setOvertimeSec(session, clockKey!, now) : overtimeSec(session, now);
  const settable = !!onSetTimer && !!clockKey && session.mode === "practice" && !session.examFormat;

  const start = () => {
    const m = Number(minutes || defaultMinutes);
    if (!Number.isFinite(m) || m < 1) return;
    onSetTimer?.(m); setOpen(false);
  };
  const defaultMinutes = clock ? String(Math.max(1, Math.round(clock.totalSec / 60))) : "10";
  const label = reading ? "Reading" : manual ? "Timer" : perSet ? "This set" : "Writing";
  const face = displayed === null
    ? <><small>Timer</small><span className="timer-idle">Set</span></>
    : expired && session.mode === "practice"
      ? <><small>{perSet ? "Set over" : "Over time"}</small>{formatClock(overtime)}</>
      : <>{(reading || session.examFormat || perSet) && <small>{label}</small>}{formatClock(displayed)}</>;
  const className = "timer" + (displayed === null ? " idle" : expired && session.mode === "practice" ? " over" : displayed <= 60 ? " low" : "");
  const aria = displayed === null ? "Set a timer for this set" : expired && session.mode === "practice" ? (perSet ? "Over this set's time" : "Practice overtime") : reading ? "Reading time remaining" : perSet ? "Time left for this set" : "Writing time remaining";

  if (!settable) return displayed === null ? null : <span className={className} title={aria}>{face}</span>;
  return (
    <div className="timer-wrap" ref={popRef}>
      <button type="button" className={className} title={aria} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setMinutes(""); setOpen((o) => !o); }}>{face}</button>
      {open && (
        <form className="timer-pop" role="dialog" aria-label="Timer for this set" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <label>Finish this set in <input autoFocus type="number" inputMode="numeric" min={1} max={300} step={1} placeholder={defaultMinutes} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes" /> min</label>
          <div className="row">
            <button type="submit" className="primary small">Start</button>
            {manual && onClearTimer && <button type="button" className="small link" onClick={() => { onClearTimer(); setOpen(false); }}>Clear</button>}
          </div>
        </form>
      )}
    </div>
  );
}
