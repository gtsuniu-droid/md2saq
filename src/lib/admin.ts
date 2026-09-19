import type { Settings } from "../data/types";

/**
 * Who may see the Admin section. Comes from VITE_ADMIN_EMAILS, a comma-separated
 * list of Google account emails. When the list is empty, Admin shows for
 * everyone and the passcode alone guards it (the original behaviour, and what
 * local development without sign-in needs). The passcode is still required on
 * the server for every change; this only decides who is shown the door.
 */
const RAW = (import.meta.env.VITE_ADMIN_EMAILS as string | undefined) ?? "";
export const ADMIN_EMAILS: string[] = RAW.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

export function adminRestricted(): boolean {
  return ADMIN_EMAILS.length > 0;
}

export function isAdmin(settings: Pick<Settings, "cloudUser"> | undefined): boolean {
  if (!adminRestricted()) return true;
  const email = settings?.cloudUser?.email?.toLowerCase();
  return !!email && ADMIN_EMAILS.includes(email);
}
