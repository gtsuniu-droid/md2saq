import { getSettings, patchSettings } from "../data/db";
import type { SocialSettings } from "../data/types";
import { publishWeeklyCount } from "./leaderboard";

/**
 * The weekly leaderboard is opt-in. Everyone signed in can see who joined; joining shows
 * you under a nickname, your first name from Google unless you choose another. Figures are
 * kept for every account either way, so admins can follow progress.
 */
export const USERNAME_MAX = 20;

/** A reason the nickname is not acceptable, or null when it is (empty is fine: the first name is used). */
export function validUsername(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  if (n.length > USERNAME_MAX) return `Keep the nickname to ${USERNAME_MAX} characters.`;
  if (!/^[A-Za-z0-9_](?:[A-Za-z0-9_ ]*[A-Za-z0-9_])?$/.test(n)) return "Use letters, numbers, spaces and underscores only.";
  if (/\s{2,}/.test(n)) return "Use single spaces between words.";
  return null;
}

export const normaliseUsername = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Save the nickname and visibility on this device (they sync between devices) and republish the week's figures. */
export async function saveSocialSettings(next: SocialSettings): Promise<void> {
  const username = next.username.trim().replace(/\s+/g, " ");
  const problem = validUsername(username);
  if (problem) throw new Error(problem);
  await patchSettings({ social: { username, leaderboard: next.leaderboard } });
  const uid = (await getSettings()).cloudUser?.uid;
  if (uid) await publishWeeklyCount(uid).catch(() => undefined);
}

/** One click from the home strip: join under the current nickname. */
export async function joinLeaderboard(): Promise<void> {
  const current = (await getSettings()).social;
  await saveSocialSettings({ username: current?.username ?? "", leaderboard: true });
}
