import type { HeatGrid } from "../lib/stats";

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

/** GitHub-style activity grid. Columns are weeks, rows Monday to Sunday. */
export default function Heatmap({ grid }: { grid: HeatGrid }) {
  return (
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
        <div className="heat-grid" style={{ gridTemplateColumns: `repeat(${grid.weeks.length}, var(--cell))` }}>
          {grid.weeks.map((week, wi) =>
            week.map((cell, di) =>
              cell ? (
                <span
                  key={`${wi}-${di}`}
                  className={`heat-cell l${cell.level}`}
                  title={`${cell.count} answered on ${cell.day}`}
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
  );
}
