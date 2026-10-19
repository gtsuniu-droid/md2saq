import type { Settings } from "../data/types";

/**
 * Who may see the Admin section. Comes from VITE_ADMIN_EMAILS, a comma-separated
 * list of Google account emails, defaulting to the site owner.
 * The passcode is still required on
 * the server for every change; this only decides who is shown the door.
 */
const RAW = (import.meta.env.VITE_ADMIN_EMAILS as string | undefined) || "gtsuniu@gmail.com";
export const ADMIN_EMAILS: string[] = RAW.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

/** The one account that can see who has signed in and hand out the admin role. Fixed, not configurable. */
export const OWNER_EMAIL = "gtsuniu@gmail.com";

export function isOwner(settings: Pick<Settings, "cloudUser"> | undefined): boolean {
  return settings?.cloudUser?.email?.toLowerCase() === OWNER_EMAIL;
}

export function adminRestricted(): boolean {
  return ADMIN_EMAILS.length > 0;
}

/**
 * Admins are the accounts named in VITE_ADMIN_EMAILS plus anyone given the admin role
 * from the People list on the Admin page (kept in Firestore, cached in settings on
 * sign-in). The passcode still guards every change to the shared library.
 */
export function isAdmin(settings: Pick<Settings, "cloudUser" | "cloudRole"> | undefined): boolean {
  const email = settings?.cloudUser?.email?.toLowerCase();
  return (!!email && ADMIN_EMAILS.includes(email)) || (!!settings?.cloudUser && settings.cloudRole === "admin");
}
