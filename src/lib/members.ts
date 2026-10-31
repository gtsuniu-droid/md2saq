import { OWNER_EMAIL } from "./admin";
import { cloudConfigured, idToken, type CloudUser } from "./firebase";

/** One record per account that has signed in, so the owner can see who uses the site. */
export interface Member {
  uid: string;
  email?: string;
  name?: string;
  photo?: string;
  createdAt?: number;
  lastSeenAt?: number;
  role?: "admin";
}

/** A sign-in is recorded once an hour per device; in between, only the role is read. */
const TOUCH_EVERY_MS = 60 * 60_000;
const authed = async (): Promise<Record<string, string> | null> => { const t = await idToken().catch(() => null); return t ? { authorization: `Bearer ${t}` } : null; };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* fine */ } };

async function call(init: RequestInit & { query?: string }): Promise<Record<string, unknown>> {
  const auth = await authed();
  if (!auth) throw new Error("Sign in first.");
  const res = await fetch(`/api/members${init.query ?? ""}`, { ...init, headers: { ...auth, ...(init.body ? { "content-type": "application/json" } : {}) } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `The request failed (${res.status}).`);
  return body;
}

/**
 * Record this sign-in and return the role the owner has given this account, if any. The role
 * is held in memory only: nothing on the device records it. Never throws: a flaky connection
 * must not block signing in.
 */
export async function touchMember(user: CloudUser): Promise<Member["role"]> {
  if (!cloudConfigured()) return undefined;
  try {
    const k = `members.touched.${user.uid}`;
    const touch = Date.now() - Number(read(k) ?? 0) > TOUCH_EVERY_MS;
    const { role } = await call({ method: touch ? "POST" : "GET" });
    if (touch) write(k, String(Date.now()));
    return role === "admin" ? "admin" : undefined;
  } catch {
    return undefined;
  }
}

/** Everyone who has signed in, most recent first. The owner only; the server enforces it. */
export async function listMembers(): Promise<Member[]> {
  const { people } = await call({ method: "GET", query: "?list" });
  return Array.isArray(people) ? (people as Member[]) : [];
}

/** Grant or remove the admin role. The site owner's accounts are always admins. */
export async function setMemberRole(uid: string, admin: boolean): Promise<void> {
  await call({ method: "PUT", body: JSON.stringify({ uid, admin }) });
}

/** The owner account alone sees the People list; it can never be demoted. */
export function isOwnerEmail(email?: string): boolean {
  return !!email && email.toLowerCase() === OWNER_EMAIL;
}
