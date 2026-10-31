import { openNamedStore, type JsonStore } from "./store";
import { accessToken, listAll, num, serviceAccount, str } from "./recount";
import { firebaseEnv } from "../functions/mcp-token";
import { OWNER_EMAIL } from "../../src/lib/owner";

/**
 * Who has signed in, and who among them is an admin, in the site's own store. The roles used
 * to be read from Firestore at every sign-in; the day its read budget ran out, every admin
 * given the role from the People list lost the Admin page and the connector's editing tools,
 * and the owner could not change roles at all. Nothing here touches Firestore except once,
 * to bring across the people and roles recorded there, and a best-effort copy of each role
 * change so the Firestore rules that still look up `members/{uid}.role` agree.
 */
export interface Person { uid: string; email: string; name: string; photo: string; createdAt: number; lastSeenAt: number; role?: "admin" }
type Roster = { people: Record<string, Omit<Person, "role">> };
type Roles = { admins: Record<string, { by: string; at: number }>; imported?: number; importTried?: number };
/** Who a request comes from, as the ID token states it. */
export interface SignedIn { uid: string; email?: string; name?: string; picture?: string; verified?: boolean; provider?: string }

const IMPORT_RETRY_MS = 10 * 60_000;
const store = () => openNamedStore("members");

/** The owner: the one account that sees the People list and gives roles, with its email verified. */
export const isOwner = (u: SignedIn): boolean => u.email?.toLowerCase() === OWNER_EMAIL && u.verified === true;

async function fromFirestore(): Promise<{ people: Roster["people"]; admins: Roles["admins"] } | null> {
  const sa = serviceAccount();
  if (!sa) return null;
  const base = `https://firestore.googleapis.com/v1/projects/${firebaseEnv().projectId ?? sa.project_id}/databases/(default)/documents`;
  const docs = await listAll(base, await accessToken(sa), "members");
  const people: Roster["people"] = {}; const admins: Roles["admins"] = {};
  for (const d of docs) {
    const uid = d.name.split("/").pop()!; const f = d.fields ?? {};
    people[uid] = { uid, email: str(f.email) ?? "", name: str(f.name) ?? "", photo: str(f.photo) ?? "", createdAt: num(f.createdAt) ?? 0, lastSeenAt: num(f.lastSeenAt) ?? 0 };
    if (str(f.role) === "admin") admins[uid] = { by: "firestore", at: 0 };
  }
  return { people, admins };
}

/** Bring the people and roles recorded in Firestore across, once; a refused read is tried again after ten minutes. */
async function imported(s: JsonStore, now: number): Promise<void> {
  if (!serviceAccount()) return;
  const claimed = await s.update<Roles>("roles", (cur) => cur?.imported || (cur?.importTried && now - cur.importTried < IMPORT_RETRY_MS) ? null : { ...(cur ?? { admins: {} }), importTried: now });
  if (claimed === null) return;
  let old: Awaited<ReturnType<typeof fromFirestore>>;
  try { old = await fromFirestore(); } catch (e) { console.warn("members: not brought across from Firestore yet:", e); return; }
  if (!old) return;
  // What the site has recorded since is newer than anything Firestore holds.
  await s.update<Roster>("roster", (cur) => ({ people: { ...old.people, ...(cur?.people ?? {}) } }));
  await s.update<Roles>("roles", (cur) => ({ admins: { ...old.admins, ...(cur?.admins ?? {}) }, imported: now }));
}

export async function roleOf(uid: string, now = Date.now(), s: JsonStore = store()): Promise<"admin" | undefined> {
  await imported(s, now);
  const roles = (await s.get("roles", { type: "json" })) as Roles | null;
  return roles?.admins[uid] ? "admin" : undefined;
}

/** Record a sign-in (first seen, last seen, current name and picture) and return the account's role. */
export async function touch(u: SignedIn, now = Date.now(), s: JsonStore = store()): Promise<"admin" | undefined> {
  await s.update<Roster>("roster", (cur) => {
    const people = { ...(cur?.people ?? {}) }; const was = people[u.uid];
    people[u.uid] = { uid: u.uid, email: (u.email ?? was?.email ?? "").slice(0, 200), name: (u.name ?? was?.name ?? "").slice(0, 200), photo: u.picture ?? was?.photo ?? "", createdAt: was?.createdAt || now, lastSeenAt: now };
    return { people };
  });
  return roleOf(u.uid, now, s);
}

/** Everyone who has signed in, most recent first, with their role. */
export async function listPeople(now = Date.now(), s: JsonStore = store()): Promise<Person[]> {
  await imported(s, now);
  const [roster, roles] = await Promise.all([s.get("roster", { type: "json" }) as Promise<Roster | null>, s.get("roles", { type: "json" }) as Promise<Roles | null>]);
  return Object.values(roster?.people ?? {}).map((p) => ({ ...p, ...(roles?.admins[p.uid] ? { role: "admin" as const } : {}) })).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** Give or take the admin role. The copy in Firestore is kept in step when it can be, for the rules that read it. */
export async function setRole(uid: string, admin: boolean, by: string, now = Date.now(), s: JsonStore = store()): Promise<void> {
  await imported(s, now);
  await s.update<Roles>("roles", (cur) => {
    const admins = { ...(cur?.admins ?? {}) };
    if (admin) admins[uid] = { by, at: now }; else delete admins[uid];
    return { ...(cur ?? {}), admins };
  });
  await mirrorRole(uid, admin).catch((e) => console.warn("members: role not copied to Firestore:", e));
}

async function mirrorRole(uid: string, admin: boolean): Promise<void> {
  const sa = serviceAccount();
  if (!sa) return;
  const base = `https://firestore.googleapis.com/v1/projects/${firebaseEnv().projectId ?? sa.project_id}/databases/(default)/documents`;
  const res = await fetch(`${base}/members/${uid}?updateMask.fieldPaths=role`, { method: "PATCH", headers: { authorization: `Bearer ${await accessToken(sa)}`, "content-type": "application/json" }, body: JSON.stringify({ fields: admin ? { role: { stringValue: "admin" } } : {} }) });
  if (!res.ok) throw new Error(`Firestore write failed (${res.status}).`);
}
