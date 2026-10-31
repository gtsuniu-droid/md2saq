import type { Config } from "@netlify/functions";
import { firebaseEnv } from "./mcp-token";
import { verifiedUser } from "../lib/idtoken";
import { isOwner, listPeople, roleOf, setRole, touch } from "../lib/members";
import { OWNER_EMAIL } from "../../src/lib/owner";

/**
 * Who has signed in and who is an admin. GET: the caller's own role; GET ?list: everyone, for
 * the owner; POST: record this sign-in and return the role; PUT {uid, admin}: the owner gives
 * or takes the admin role.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request): Promise<Response> => {
  const { projectId } = firebaseEnv();
  if (!projectId) return json({ error: "Sign-in is not configured on this site." }, 503);
  const me = await verifiedUser(req, projectId);
  if (!me) return json({ error: "Sign in first." }, 401);
  if (req.method === "GET") {
    if (!new URL(req.url).searchParams.has("list")) return json({ role: (await roleOf(me.uid)) ?? null });
    if (!isOwner(me)) return json({ error: "The owner alone sees the list." }, 403);
    return json({ people: await listPeople() });
  }
  if (req.method === "POST") return json({ role: (await touch(me)) ?? null });
  if (req.method === "PUT") {
    if (!isOwner(me)) return json({ error: "The owner alone changes roles." }, 403);
    const body = (await req.json().catch(() => null)) as { uid?: unknown; admin?: unknown } | null;
    const uid = typeof body?.uid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.uid) ? body.uid : null;
    if (!uid || typeof body?.admin !== "boolean") return json({ error: "Say whose role to change, and to what." }, 400);
    const person = (await listPeople()).find((p) => p.uid === uid);
    if (uid === me.uid || person?.email.toLowerCase() === OWNER_EMAIL) return json({ error: "The owner is always an admin." }, 400);
    await setRole(uid, body.admin, me.uid);
    return json({ role: body.admin ? "admin" : null });
  }
  return json({ error: "Method not allowed." }, 405);
};

export const config: Config = { path: "/api/members" };
