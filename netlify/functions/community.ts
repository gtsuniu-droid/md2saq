import type { Config } from "@netlify/functions";
import { caller, firebaseEnv } from "./mcp-token";
import { verifiedUser } from "../lib/idtoken";
import { addPost, readPage, removePost, setResolved } from "../lib/community";
import { communityBody, communitySource, validateCommunityTarget, validCommunityKind, type CommunityChannel, type CommunityKind, type CommunityTarget } from "../../src/lib/communityModel";

/**
 * Reports, suggestions and discussion under a published question, for signed-in students.
 * GET ?bank=&q=&channel=&cursor= reads a page. POST { bank, q, channel, action } with action
 * "post" (id, body, kind, source?), "delete" (id) or "resolve" (id, resolved). A post carries
 * the name and picture from the author's own sign-in.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function where(bank: unknown, q: unknown, channel: unknown): { target: CommunityTarget; channel: CommunityChannel } | null {
  if (channel !== "suggestions" && channel !== "discussion") return null;
  const target = { bankId: String(bank ?? ""), questionId: String(q ?? "") };
  try { validateCommunityTarget(target); return { target, channel }; } catch { return null; }
}

export default async (req: Request): Promise<Response> => {
  try { return await handle(req); }
  catch (e) { return json({ error: e instanceof Error ? e.message : "Could not complete that." }, 400); }
};

async function handle(req: Request): Promise<Response> {
  const { projectId, adminEmails } = firebaseEnv();
  if (!projectId) return json({ error: "Sign-in is not configured on this site." }, 503);
  const me = await verifiedUser(req, projectId);
  if (!me) return json({ error: "Sign in first." }, 401);
  if (req.method === "GET") {
    const url = new URL(req.url);
    const at = where(url.searchParams.get("bank"), url.searchParams.get("q"), url.searchParams.get("channel"));
    if (!at) return json({ error: "Unknown question." }, 400);
    return json(await readPage(at.target, at.channel, Math.max(0, Number(url.searchParams.get("cursor")) || 0)));
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const at = where(b?.bank, b?.q, b?.channel);
  const id = typeof b?.id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(b.id) ? b.id : "";
  if (!b || !at || !id) return json({ error: "Unknown post." }, 400);
  // Moderators: the site's admin emails, or an admin role granted from the People list.
  const moderator = async () => (!!me.email && adminEmails.includes(me.email)) || await caller(req).then((w) => !(w instanceof Response) && (w.role === "owner" || w.role === "admin"));
  if (b.action === "post") {
    const kind = b.kind as CommunityKind;
    if (!validCommunityKind(at.channel, kind)) return json({ error: "Unknown kind of post." }, 400);
    const source = at.channel === "suggestions" ? communitySource(typeof b.source === "string" ? b.source : "") : "";
    await addPost(at.target, at.channel, {
      id, authorId: me.uid, authorName: me.name || (me.email ? me.email.split("@")[0] : "Member"), ...(me.picture ? { authorPhoto: me.picture } : {}),
      body: communityBody(typeof b.body === "string" ? b.body : ""), ...(source ? { source } : {}), kind, resolved: false, createdAt: Date.now(),
    });
    return json({ ok: true }, 201);
  }
  if (b.action === "delete") {
    // Authors delete their own without the moderator check; anyone else needs it.
    try { await removePost(at.target, at.channel, id, me.uid, false); }
    catch { if (!await moderator()) return json({ error: "Only its author or a moderator can delete a post." }, 403); await removePost(at.target, at.channel, id, me.uid, true); }
    return json({ ok: true });
  }
  if (b.action === "resolve" && at.channel === "suggestions" && typeof b.resolved === "boolean") {
    if (!await moderator()) return json({ error: "Only a moderator can resolve a report." }, 403);
    await setResolved(at.target, id, b.resolved);
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}

export const config: Config = { path: "/api/community" };
