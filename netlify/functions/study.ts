import type { Config } from "@netlify/functions";
import { firebaseEnv } from "./mcp-token";
import { verifiedUid } from "../lib/idtoken";
import { createStudy, joinStudy, readStudy, validStudy } from "../lib/studyStore";

/**
 * Study codes for signed-in students. POST { create: study } makes a code; GET ?code= looks
 * one up; POST { join: code, name, photo? } adds the caller to it.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request): Promise<Response> => {
  const { projectId } = firebaseEnv();
  if (!projectId) return json({ error: "Sign-in is not configured on this site." }, 503);
  const uid = await verifiedUid(req, projectId);
  if (!uid) return json({ error: "Sign in first." }, 401);
  if (req.method === "GET") {
    const code = new URL(req.url).searchParams.get("code") ?? "";
    if (!/^\d{6}$/.test(code)) return json({ error: "A study code has six digits." }, 400);
    const study = await readStudy(code);
    return study ? json(study) : json({ error: "No such code." }, 404);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const b = (await req.json().catch(() => null)) as { create?: unknown; join?: unknown; name?: unknown; photo?: unknown } | null;
  if (b?.create !== undefined) {
    const study = validStudy(b.create);
    if (!study) return json({ error: "That study could not be read." }, 400);
    return json(await createStudy(uid, study), 201);
  }
  if (typeof b?.join === "string" && /^\d{6}$/.test(b.join) && typeof b.name === "string" && b.name.trim()) {
    const photo = typeof b.photo === "string" && /^https:\/\//.test(b.photo) ? b.photo.slice(0, 2000) : undefined;
    const study = await joinStudy(b.join, { uid, name: b.name.trim().slice(0, 40), ...(photo ? { photo } : {}) });
    return study ? json(study) : json({ error: "No such code." }, 404);
  }
  return json({ error: "Send create, or join with a name." }, 400);
};

export const config: Config = { path: "/api/study" };
