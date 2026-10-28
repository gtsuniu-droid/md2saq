import type { Config } from "@netlify/functions";
import { firebaseEnv } from "./mcp-token";
import { keepSet, mySets, validSet } from "../lib/answers";
import { verifiedUid } from "../lib/idtoken";

/**
 * The signed-in student's own sets for marking. POST keeps one (sent when its marking page
 * opens); GET ?key= returns the marks suggested for it, if any.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request): Promise<Response> => {
  const { projectId } = firebaseEnv();
  if (!projectId) return json({ error: "Sign-in is not configured on this site." }, 503);
  const uid = await verifiedUid(req, projectId);
  if (!uid) return json({ error: "Sign in first." }, 401);
  if (req.method === "POST") {
    const set = validSet(await req.json().catch(() => null));
    if (!set) return json({ error: "That set could not be read." }, 400);
    await keepSet(uid, set);
    return new Response(null, { status: 204 });
  }
  if (req.method === "GET") {
    const key = new URL(req.url).searchParams.get("key") ?? "";
    const set = (await mySets(uid)).find((s) => s.key === key);
    return json({ suggested: set?.suggested ?? null });
  }
  return json({ error: "Method not allowed." }, 405);
};

export const config: Config = { path: "/api/answers" };
