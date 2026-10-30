import type { Config, Context } from "@netlify/functions";
import { caller } from "./mcp-token";
import { readRecords } from "../lib/board";
import { recount, recountLater, serviceAccount } from "../lib/recount";
import { openNamedStore } from "../lib/store";
import { CACHE_KEY, CACHE_MS, current, publicBoard, staleTable, weekStart, type CacheBody } from "../lib/progress";

/**
 * The board, and every account's weekly figures for the Admin page. Both are the last full
 * count with each device's latest record laid over it, read from the site's own store: two
 * blob reads, and no Firestore read at all unless a new full count is due.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request, context?: Context): Promise<Response> => {
  try { return await handle(req, context); }
  catch (e) { console.error("progress:", e); return json({ error: `Progress could not be computed: ${e instanceof Error ? e.message : String(e)}` }, 500); }
};

async function handle(req: Request, context?: Context): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  // ?board=1 is the public leaderboard: anyone, signed in or not; joined accounts only, nicknames
  // only. It shows the same to everyone, so the sign-in is not checked (that costs two calls to Google).
  const isBoard = new URL(req.url).searchParams.has("board");
  const who: { role: "owner" | "admin" | "student" } | Response = isBoard ? { role: "student" } : await caller(req);
  if (who instanceof Response) return who;
  if (who.role === "student" && !isBoard) return json({ error: "Admins only." }, 403);
  const now = Date.now();
  const [last, posted] = await Promise.all([
    openNamedStore("bank").get(CACHE_KEY, { type: "json" }) as Promise<CacheBody | null>,
    readRecords(),
  ]);
  if (isBoard) {
    recountLater(last, context);
    // The same for everyone, so Netlify's CDN may answer repeat reads for half a minute without
    // running this at all: open boards refresh themselves, and that keeps it cheap.
    return new Response(JSON.stringify(publicBoard(current(last, posted, now))), { headers: {
      "content-type": "application/json", "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, durable, s-maxage=10, stale-while-revalidate=20", "netlify-vary": "query=board",
    } });
  }
  if (!serviceAccount()) return json({ error: "Server-side progress is not configured: add FIREBASE_SERVICE_ACCOUNT to the site's environment." }, 503);
  let body: CacheBody;
  if (last && last.week === weekStart(now) && now - last.at < CACHE_MS) body = current(last, posted, now);
  else {
    try { body = current(await recount(posted, now), posted, now); }
    catch (e) {
      // Firestore refused (its daily read budget, most likely): the last count with every record since.
      console.warn("progress: Firestore unreadable, serving the last table:", e);
      body = staleTable(last, posted, now, e instanceof Error ? e.message : String(e));
    }
  }
  const state = body.stale ? { stale: true, asOf: body.asOf, reason: body.reason } : {};
  return json({ week: body.week, ...state, accounts: body.accounts, emailsIncluded: who.role === "owner", rows: who.role === "owner" ? body.rowsWithEmail : body.rowsWithEmail.map((r) => ({ ...r, email: undefined })) });
}

export const config: Config = { path: "/api/progress" };
