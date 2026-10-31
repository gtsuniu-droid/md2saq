/**
 * A line for whoever leads the week, under the podium: one of these, picked afresh each
 * visit, only when the lead is worth crowing about (five questions or more). The last one
 * laughs at second and third place, so it needs both.
 */
export const LEADER_LINES: { text: string; emoji?: string; rivals?: boolean }[] = [
  { text: "{name} is cooking", emoji: "🍳" },
  { text: "{name} mogs both Talley and O'Connor", emoji: "🗿" },
  { text: "{name} is eating and leaving no crumbs" },
  { text: "{name} is on demon time", emoji: "😈" },
  { text: "{name} is locked in", emoji: "🔒" },
  { text: "gg too EZ" },
  { text: "too easy mate" },
  { text: "{second} and {third}, 🤣😂🫵", rivals: true },
];

export const LEADER_LINE_MIN = 5;

/**
 * The line for this leader, or null when the lead is too small to make a fuss of. `pick` is a
 * number in [0, 1). `worthy` says whether the lead deserves a line when the board is ranked
 * by something other than questions (sets). `rivals` are the names in second and third place.
 */
export function leaderLine(name: string, count: number, pick = Math.random(), worthy = count >= LEADER_LINE_MIN, rivals: string[] = []): string | null {
  if (!worthy) return null;
  const fitting = LEADER_LINES.filter((l) => !l.rivals || rivals.length >= 2);
  const line = fitting[Math.min(fitting.length - 1, Math.floor(Math.max(0, Math.min(0.999999, pick)) * fitting.length))];
  const text = line.text.replaceAll("{name}", name).replaceAll("{second}", rivals[0] ?? "").replaceAll("{third}", rivals[1] ?? "");
  return line.emoji ? `${text} ${line.emoji}` : text;
}
