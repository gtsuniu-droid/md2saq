import type { Config, Context } from "@netlify/functions";
import { firebaseEnv } from "./mcp-token";
import { recountLater } from "../lib/recount";
import { postRecord } from "../lib/board";
import { verifiedUid } from "../lib/idtoken";
import { openNamedStore } from "../lib/store";
import { CACHE_KEY, current, publicBoard, type CacheBody, type Posted } from "../lib/progress";

/**
 * A device's leaderboard record. The board is served from these, kept in the site's own store
 * rather than Firestore, whose free plan has a daily read budget: once that is spent nothing
 * there can be read until the next day, and anyone known only to Firestore would drop off.
 *
 * The reply is the board with this record in it, so opening the board publishes your count
 * and reads everyone's in one request, and the next visitor sees your figure at once.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request, context?: Context): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { projectId } = firebaseEnv();
  if (!projectId) return json({ error: "Sign-in is not configured on this site." }, 503);
  const uid = await verifiedUid(req, projectId);
  if (!uid) return json({ error: "Sign in first." }, 401);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return json({ error: "Send the record as JSON." }, 400);
  const count = (k: string) => { const v = b[k]; return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0; };
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : "";
  const week = typeof b.week === "string" && /^\d{4}-W\d{2}$/.test(b.week) ? b.week : "";
  if (!name || !week) return json({ error: "A name and a week are needed." }, 400);
  const photo = typeof b.photo === "string" && /^https:\/\//.test(b.photo) ? b.photo.slice(0, 2000) : undefined;
  // A device that never saw the student join or leave sends no `visible`, and has no say.
  const now = Date.now();
  const post: Posted = { name, ...(photo ? { photo } : {}), ...(typeof b.visible === "boolean" ? { visible: b.visible, choiceAt: Math.min(count("choiceAt"), now) } : {}), week, count: count("count"), sets: count("sets"), prevCount: count("prevCount"), prevSets: count("prevSets"), total: count("total"), totalSets: count("totalSets"), ...(b.complete === true ? { complete: true } : {}), at: now };
  const [records, last] = await Promise.all([
    postRecord(uid, post),
    openNamedStore("bank").get(CACHE_KEY, { type: "json" }) as Promise<CacheBody | null>,
  ]);
  recountLater(last, context);
  return json(publicBoard(current(last, records, now)));
};

export const config: Config = { path: "/api/board" };
