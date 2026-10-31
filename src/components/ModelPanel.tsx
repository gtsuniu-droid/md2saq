import type { ReactNode } from "react";
import ModelAnswerContent from "./ModelAnswerContent";
import { hasModelAnswer, type ModelAnswer } from "../lib/modelAnswer";
import type { TickList } from "../lib/markingTicks";

interface Props {
  answer: ModelAnswer;
  /** The model answer as a tick list, when it is written as one; null shows it as written only. */
  list?: TickList | null;
  /** Showing the tick list rather than the text as written. */
  asTicks?: boolean;
  onAsTicks?: (asTicks: boolean) => void;
  /** Rows ticked so far, and what to do when one is pressed. */
  pointsHit?: number[];
  onTick?: (rowIndex: number) => void;
  folded: boolean;
  onToggle: () => void;
  /** Further quiet buttons on the bar (editing, for admins). */
  actions?: ReactNode;
  /** What to say when there is no model answer for this part. */
  emptyText?: string;
  className?: string;
}

function ModelIcon() {
  return <svg className="mark-model-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" opacity=".14" /><path d="M4.5 8.2 7 10.6l4.6-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/**
 * The model answer under an answer, wherever marking happens: a bar that folds it away, and
 * inside either the text as written or, when the bank wrote it one point per line, a tick list
 * whose ticks add up to the score. The set marking page and Mark together both use it, so
 * marking a friend's answer looks and works like marking your own.
 */
export default function ModelPanel({ answer, list = null, asTicks = false, onAsTicks, pointsHit = [], onTick, folded, onToggle, actions, emptyText = "No model answer for this part.", className = "" }: Props) {
  return (
    <div className={`mark-panel${folded ? " folded" : ""}${className ? ` ${className}` : ""}`}>
      <div className="mark-panel-head" onClick={onToggle}>
        <button type="button" className="mark-model-toggle" aria-expanded={!folded} onClick={(e) => { e.stopPropagation(); onToggle(); }}><ModelIcon />Model answer<svg className={"mark-model-chevron" + (folded ? "" : " open")} viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        <span style={{ flex: 1 }} />
        {list && !folded && onAsTicks && <button type="button" className="small link mark-model-edit" aria-pressed={asTicks} title="Tick the points made and the score adds up; or read the model answer as written" onClick={(e) => { e.stopPropagation(); onAsTicks(!asTicks); }}>{asTicks ? "As written" : "Tick list"}</button>}
        {actions}
      </div>
      {!folded && <div className="mark-model-body">
        {list && asTicks ? <>
          <ul className="tick-list">{list.rows.map((r) => <li key={r.index}><label className={"tick-row" + (pointsHit.includes(r.index) ? " on" : "")}><input type="checkbox" checked={pointsHit.includes(r.index)} disabled={!onTick} onChange={() => onTick?.(r.index)} /><span>{r.text}</span><span className="tick-marks">{r.marks}</span></label></li>)}</ul>
          {list.guidance.length > 0 && <details className="tick-guidance"><summary>Marking guidance</summary>{list.guidance.map((g, i) => <p key={i} className="pre">{g}</p>)}</details>}
        </> : hasModelAnswer(answer) ? <ModelAnswerContent answer={answer} /> : <p className="muted">{emptyText}</p>}
      </div>}
    </div>
  );
}
