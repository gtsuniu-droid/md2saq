import type { Config, Context } from "@netlify/functions";
import { firebaseEnv } from "./mcp-token";
import { changes, fetchRecords, push, readIndex, validId, validPush, type Table } from "../lib/accountStore";
import { importDue, importFromFirestore } from "../lib/accountImport";
import { verifiedUid } from "../lib/idtoken";

/**
 * The signed-in student's own records, in the site's store (see lib/accountStore.ts).
 *   GET  /api/account/changes?since=<cursor>  what arrived since then, and the cursor for next time;
 *                                              the account's old Firestore records fold in behind it, a page per pull
 *   POST /api/account/fetch   { keys: [{ table, id }] }  the records named, as many as fit, and which are left
 *   POST /api/account/push    { attempts, marks, notes, settings, session, deletes }  a device's changes
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request, context?: Context): Promise<Response> => {
  const { projectId } = firebaseEnv();
  if (!projectId) return json({ error: "Sign-in is not configured on this site." }, 503);
  const uid = await verifiedUid(req, projectId);
  if (!uid) return json({ error: "Sign in first." }, 401);
  const url = new URL(req.url);
  const action = url.pathname.split("/").pop();
  try {
    if (req.method === "GET" && action === "changes") {
      const since = Number(url.searchParams.get("since") ?? 0) || 0;
      const index = await readIndex(uid);
      if (importDue(index, Date.now())) {
        // A page of the old records per pull, after this reply has gone; locally there is no background, so it runs first.
        const work = importFromFirestore(uid).catch((e) => console.warn(`account: import for ${uid} failed:`, e));
        if (context?.waitUntil) context.waitUntil(work); else { await work; return json(await changes(uid, since)); }
      }
      return json(await changes(uid, since, Date.now(), undefined, index));
    }
    if (req.method === "POST" && action === "fetch") {
      const body = (await req.json().catch(() => null)) as { keys?: unknown } | null;
      const keys = Array.isArray(body?.keys) ? body!.keys.filter((k): k is { table: Table; id: string } => !!k && typeof k === "object" && (k.table === "attempts" || k.table === "marks" || k.table === "notes") && validId(k.id)) : null;
      if (!keys) return json({ error: "Name the records to fetch." }, 400);
      return json(await fetchRecords(uid, keys));
    }
    if (req.method === "POST" && action === "push") {
      const body = validPush(await req.json().catch(() => null));
      if (!body) return json({ error: "Those records could not be read." }, 400);
      return json(await push(uid, body));
    }
  } catch (e) {
    console.error("account:", e);
    return json({ error: "The account store is unavailable right now." }, 503);
  }
  return json({ error: "Not found." }, 404);
};

export const config: Config = { path: "/api/account/*" };
