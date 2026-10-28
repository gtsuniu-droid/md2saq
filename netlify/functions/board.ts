import type { Config } from "@netlify/functions";
import { caller } from "./mcp-token";
import { openNamedStore } from "../lib/store";
import type { BoardRecord } from "../lib/progress";

/**
 * A device's leaderboard record, kept in the site's own store as well as in Firestore.
 * Firestore's free plan has a daily read budget; once it is spent, nothing there can be
 * read until the next day, but this store can, so what students do in the meantime
 * (answers, joining, a nickname) still reaches the board.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const who = await caller(req);
  if (who instanceof Response) return who;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return json({ error: "Send the record as JSON." }, 400);
  const count = (k: string) => { const v = b[k]; return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0; };
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : "";
  const week = typeof b.week === "string" && /^\d{4}-W\d{2}$/.test(b.week) ? b.week : "";
  if (!name || !week) return json({ error: "A name and a week are needed." }, 400);
  const photo = typeof b.photo === "string" && /^https:\/\//.test(b.photo) ? b.photo.slice(0, 2000) : undefined;
  const record: BoardRecord = { name, ...(photo ? { photo } : {}), visible: b.visible === true, week, count: count("count"), sets: count("sets"), prevCount: count("prevCount"), prevSets: count("prevSets"), at: Date.now() };
  await openNamedStore("board").setJSON(`board/${who.uid}`, record);
  return new Response(null, { status: 204 });
};

export const config: Config = { path: "/api/board" };
