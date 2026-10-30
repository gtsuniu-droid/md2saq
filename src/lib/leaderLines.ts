/**
 * A line for whoever leads the week, under the podium: one of these, picked afresh each
 * visit. Only when the lead is worth crowing about (five questions or more), and the lines
 * that quote the count only once it is a big one.
 */
export const LEADER_LINES: { text: string; minCount?: number }[] = [
  { text: "{name} is cooking." },
  { text: "{name} is very demure, very mindful, very first." },
  { text: "{name} understood the assignment." },
  { text: "It's giving {name}." },
  { text: "{name} said “bet” and answered {count} questions.", minCount: 20 },
  { text: "{name} ate and left no crumbs." },
  { text: "Let {name} cook." },
  { text: "{name} is in their flop-proof era." },
  { text: "Sigma grindset: {name}." },
  { text: "{name} is locked in." },
  { text: "{name} is on demon time with the SAQs." },
  { text: "{name} is gatekeeping first place." },
  { text: "{name} is the main character this week." },
  { text: "Skill issue for everyone except {name}." },
  { text: "{name} has {count} questions and zero chill.", minCount: 20 },
  { text: "{name} is lowkey carrying the whole board." },
];

export const LEADER_LINE_MIN = 5;

/** The line for this leader, or null when the lead is too small to make a fuss of. `pick` is a number in [0, 1). */
export function leaderLine(name: string, count: number, pick = Math.random()): string | null {
  if (count < LEADER_LINE_MIN) return null;
  const fitting = LEADER_LINES.filter((l) => count >= (l.minCount ?? 0));
  const line = fitting[Math.min(fitting.length - 1, Math.floor(Math.max(0, Math.min(0.999999, pick)) * fitting.length))];
  return line.text.replaceAll("{name}", name).replaceAll("{count}", String(count));
}
