/** How a score went, for its colour wherever scores show: 70% or more, 50% or more, or less. */
export type ScoreBand = "good" | "mid" | "low";
export const scoreBand = (percent: number): ScoreBand => (percent >= 70 ? "good" : percent >= 50 ? "mid" : "low");
