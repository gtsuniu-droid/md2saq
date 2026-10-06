import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HeatCell, HeatGrid } from "../lib/stats";

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

/** GitHub-style activity grid. Columns are weeks, rows Monday to Sunday. */
export default function Heatmap({ grid }: { grid: HeatGrid }) {
  const [hover, setHover] = useState<{ text: string; date: string; count: number; x: number; y: number; below: boolean } | null>(null);
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLSpanElement>());
  const keyboardHint = useId();
  const cells = grid.weeks.flat().filter((cell): cell is HeatCell => cell !== null);
  const entryDay = cells.some(cell => cell.day === focusedDay) ? focusedDay : cells.at(-1)?.day;
  const describe = (cell: HeatCell) => `${cell.count} question${cell.count === 1 ? "" : "s"} completed on ${new Date(cell.ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  const show = (element: HTMLElement, cell: HeatCell) => {
    const rect = element.getBoundingClientRect();
    const below = rect.top < 85;
    setHover({ text: describe(cell), date: new Date(cell.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), count: cell.count, x: Math.max(100, Math.min(window.innerWidth - 100, rect.left + rect.width / 2)), y: below ? rect.bottom + 8 : rect.top - 8, below });
  };
  useEffect(() => {
    const clear = () => setHover(null);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => { window.removeEventListener("scroll", clear, true); window.removeEventListener("resize", clear); };
  }, []);
  useEffect(() => { setHover(null); }, [grid]);
  return (
    <>
    <span id={keyboardHint} className="sr-only">Use up and down arrows to move by day, left and right arrows to move by week, and Home or End to reach the first or last day.</span>
    <div className="heat">
      <div className="heat-months" style={{ gridTemplateColumns: `repeat(${grid.weeks.length}, var(--cell))` }}>
        {grid.months.map((m) => (
          <span key={m.col} style={{ gridColumn: m.col + 1 }}>{m.label}</span>
        ))}
      </div>
      <div className="heat-body">
        <div className="heat-days">
          {DAY_LABELS.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="heat-grid" role="group" aria-label="Study activity" aria-describedby={keyboardHint} style={{ gridTemplateColumns: `repeat(${grid.weeks.length}, var(--cell))` }}>
          {grid.weeks.map((week, wi) =>
            week.map((cell, di) =>
              cell ? (
                <span
                  key={`${wi}-${di}`}
                  ref={element => { if (element) cellRefs.current.set(cell.day, element); else cellRefs.current.delete(cell.day); }}
                  className={`heat-cell l${cell.level}`}
                  tabIndex={cell.day === entryDay ? 0 : -1}
                  role="img"
                  aria-label={describe(cell)}
                  data-active={hover?.text === describe(cell) || undefined}
                  onMouseEnter={e => show(e.currentTarget, cell)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={e => { setFocusedDay(cell.day); show(e.currentTarget, cell); }}
                  onBlur={() => setHover(null)}
                  onClick={e => show(e.currentTarget, cell)}
                  onKeyDown={e => {
                    if (e.key === "Escape") { setHover(null); return; }
                    const index = cells.findIndex(item => item.day === cell.day);
                    const next = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1
                      : e.key === "ArrowLeft" ? index - 7 : e.key === "ArrowRight" ? index + 7
                      : e.key === "Home" ? 0 : e.key === "End" ? cells.length - 1 : undefined;
                    if (next === undefined) return;
                    e.preventDefault();
                    const target = cells[Math.max(0, Math.min(cells.length - 1, next))];
                    cellRefs.current.get(target.day)?.focus();
                  }}
                  style={{ gridColumn: wi + 1, gridRow: di + 1 }}
                />
              ) : (
                <span key={`${wi}-${di}`} className="heat-cell empty" style={{ gridColumn: wi + 1, gridRow: di + 1 }} />
              ),
            ),
          )}
        </div>
      </div>
    </div>
    {hover && createPortal(<div role="tooltip" className="heat-tooltip" style={{ left: hover.x, top: hover.y, transform: `translate(-50%, ${hover.below ? "0" : "-100%"})` }}><span>{hover.date}</span><strong>{hover.count} question{hover.count === 1 ? "" : "s"}</strong></div>, document.body)}
    </>
  );
}
