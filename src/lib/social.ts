import { getSettings, patchSettings } from "../data/db";
import type { SocialSettings } from "../data/types";
import { cloudConfigured, communityServices } from "./firebase";

/**
 * The weekly leaderboard is opt-in. A person chooses a username; only that is ever shown
 * to other students, never the account's real name or email. The public profile lives in
 * Firestore under profiles/{uid}, readable by any signed-in student, writable by its owner.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** A reason the username is not acceptable, or null when it is. */
export function validUsername(name: string): string | null {
  const n = name.trim();
  if (n.length < USERNAME_MIN) return `Choose a username of at least ${USERNAME_MIN} characters.`;
  if (n.length > USERNAME_MAX) return `Keep the username to ${USERNAME_MAX} characters.`;
  if (!/^[A-Za-z0-9_](?:[A-Za-z0-9_ ]*[A-Za-z0-9_])?$/.test(n)) return "Use letters, numbers, spaces and underscores only.";
  if (/\s{2,}/.test(n)) return "Use single spaces between words.";
  return null;
}

export const normaliseUsername = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

export async function usernameTaken(username: string, exceptUid: string): Promise<boolean> {
  const { firestore } = await communityServices();
  const { collection, getDocs, limit, query, where } = await import("firebase/firestore");
  const snap = await getDocs(query(collection(firestore, "profiles"), where("usernameLower", "==", normaliseUsername(username)), limit(3)));
  return snap.docs.some((d) => d.id !== exceptUid);
}

/** Save the choice on this device (it syncs between devices) and in the account's public profile. */
export async function saveSocialSettings(next: SocialSettings): Promise<void> {
  const username = next.username.trim().replace(/\s+/g, " ");
  const problem = validUsername(username);
  if (next.leaderboard && problem) throw new Error(problem);
  const settings = await getSettings();
  const user = settings.cloudUser;
  if (next.leaderboard && !user) throw new Error("Sign in first; the leaderboard needs an account.");
  if (user && cloudConfigured()) {
    const { firestore } = await communityServices();
    const { deleteDoc, doc, serverTimestamp, setDoc } = await import("firebase/firestore");
    if (next.leaderboard) {
      if (await usernameTaken(username, user.uid)) throw new Error("That username is taken. Choose another.");
      await setDoc(doc(firestore, "profiles", user.uid), { uid: user.uid, username, usernameLower: normaliseUsername(username), showLeaderboard: true, updatedAt: serverTimestamp() });
    } else {
      await deleteDoc(doc(firestore, "leaderboard", user.uid)).catch(() => undefined);
      await deleteDoc(doc(firestore, "profiles", user.uid)).catch(() => undefined);
    }
  }
  await patchSettings({ social: { username, leaderboard: next.leaderboard, declined: next.leaderboard ? false : next.declined ?? settings.social?.declined } });
}

/** The one-time invitation was turned down: hide the home panel until Settings turns it on. */
export async function declineLeaderboard(): Promise<void> {
  const current = (await getSettings()).social;
  await patchSettings({ social: { username: current?.username ?? "", leaderboard: false, declined: true } });
}
