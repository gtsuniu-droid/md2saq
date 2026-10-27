import type { Config } from "@netlify/functions";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { caller, firebaseEnv } from "./mcp-token";
import { hosted, openNamedStore } from "../lib/store";
import { weekStart, weeklyFigures, type AttemptRow } from "../lib/progress";

/**
 * Every account's weekly figures for the Admin page, computed here from each student's
 * submitted attempts with a Firebase service account, so the table is complete whether or
 * not a student has opened the site. Needs FIREBASE_SERVICE_ACCOUNT (the key's JSON) on
 * Netlify, or in .env.local when developing.
 */
interface ServiceAccount { client_email: string; private_key: string; project_id: string }
type FsValue = { stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean; mapValue?: { fields?: Record<string, FsValue> }; timestampValue?: string; nullValue?: null };
type FsDoc = { name: string; fields?: Record<string, FsValue> };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function serviceAccount(): ServiceAccount | null {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw && !hosted()) {
    try {
      const line = readFileSync(`${process.cwd()}/.env.local`, "utf8").split("\n").find((l) => l.startsWith("FIREBASE_SERVICE_ACCOUNT="));
      raw = line?.slice("FIREBASE_SERVICE_ACCOUNT=".length).replace(/^'|'$/g, "");
    } catch { /* none */ }
  }
  if (!raw) return null;
  try { const sa = JSON.parse(raw) as ServiceAccount; return sa.client_email && sa.private_key && sa.project_id ? sa : null; } catch { return null; }
}

let cachedToken: { value: string; expires: number } | null = null;
/** An OAuth access token for Firestore, signed with the service account's key. */
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  if (!res.ok) throw new Error(`Google refused the service account (${res.status}).`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

const num = (v?: FsValue): number | undefined => v?.integerValue !== undefined ? Number(v.integerValue) : v?.doubleValue !== undefined ? v.doubleValue : v?.timestampValue ? Date.parse(v.timestampValue) : undefined;
const str = (v?: FsValue): string | undefined => v?.stringValue;

async function listAll(base: string, token: string, path: string): Promise<FsDoc[]> {
  const out: FsDoc[] = [];
  let pageToken = "";
  do {
    const res = await fetch(`${base}/${path}?pageSize=500${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Firestore read failed (${res.status}) for ${path}.`);
    const body = (await res.json()) as { documents?: FsDoc[]; nextPageToken?: string };
    out.push(...(body.documents ?? []));
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** Submitted attempts of one account since `since`, as the figures need them. */
async function attemptsOf(base: string, token: string, uid: string, since: number): Promise<AttemptRow[]> {
  const res = await fetch(`${base}/users/${uid}:runQuery`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "attempts" }], where: { fieldFilter: { field: { fieldPath: "submittedAt" }, op: "GREATER_THAN_OR_EQUAL", value: { integerValue: String(since) } } }, limit: 5000 } }) });
  if (!res.ok) throw new Error(`Could not read attempts (${res.status}).`);
  const rows = (await res.json()) as { document?: FsDoc }[];
  return rows.flatMap(({ document }) => {
    const f = document?.fields; const submittedAt = num(f?.submittedAt);
    if (!f || submittedAt === undefined) return [];
    const qref = f.qref?.mapValue?.fields;
    return [{ uid, submittedAt, questionId: str(f.questionId) ?? "", bankId: str(qref?.bankId), order: num(qref?.order) }];
  });
}

/**
 * Reads are the scarce resource (the free Firestore quota is a daily budget), so the result
 * is cached for every visitor in the bank's blob store, and attempts are read only for
 * accounts whose own device has not published a fresh figure this week.
 */
const CACHE_KEY = "progress-cache";
const CACHE_MS = 10 * 60_000;
type CacheBody = { at: number; week: number; accounts: number; rowsWithEmail: Record<string, unknown>[] };
let cache: CacheBody | null = null;

export default async (req: Request): Promise<Response> => {
  try { return await handle(req); }
  catch (e) { console.error("progress:", e); return json({ error: `Progress could not be computed: ${e instanceof Error ? e.message : String(e)}` }, 500); }
};

async function handle(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  const who = await caller(req);
  if (who instanceof Response) return who;
  // ?board=1 is the public leaderboard: any signed-in student, joined accounts only, nicknames only.
  const publicBoard = new URL(req.url).searchParams.has("board");
  if (who.role === "student" && !publicBoard) return json({ error: "Admins only." }, 403);
  const sa = serviceAccount();
  if (!sa) return json({ error: "Server-side progress is not configured: add FIREBASE_SERVICE_ACCOUNT to the site's environment." }, 503);
  const respond = (body: CacheBody) => {
    if (publicBoard) return json({ week: body.week, rows: body.rowsWithEmail.filter((r) => r.joined).map((r) => ({ uid: r.uid, name: r.nickname || r.name, photo: r.photo, questions: r.questions, sets: r.sets, prevQuestions: r.prevQuestions, prevSets: r.prevSets })) });
    return json({ week: body.week, accounts: body.accounts, emailsIncluded: who.role === "owner", rows: who.role === "owner" ? body.rowsWithEmail : body.rowsWithEmail.map((r) => ({ ...r, email: undefined })) });
  };
  const store = openNamedStore("bank");
  if (!cache || Date.now() - cache.at >= 60_000) cache = ((await store.get(CACHE_KEY, { type: "json" })) as CacheBody | null) ?? cache;
  if (cache && Date.now() - cache.at < CACHE_MS && cache.week === weekStart(Date.now())) return respond(cache);
  const { projectId } = firebaseEnv();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId ?? sa.project_id}/databases/(default)/documents`;
  const token = await accessToken(sa);
  const [members, board, index] = await Promise.all([
    listAll(base, token, "members"),
    listAll(base, token, "leaderboard"),
    store.get("index", { type: "json" }) as Promise<{ id: string; questionCount: number }[] | null>,
  ]);
  const questionCount = new Map((index ?? []).map((e) => [e.id, e.questionCount]));
  const now = Date.now();
  const since = weekStart(now) - 7 * 24 * 3600 * 1000;
  const nick = new Map(board.map((d) => [d.name.split("/").pop()!, d.fields]));
  const thisWeek = weekKey(now);
  // A device that published this week within the last day is trusted; others are computed from their attempts.
  const fresh = (uid: string) => { const n = nick.get(uid); const at = num(n?.updatedAt); return str(n?.week) === thisWeek && at !== undefined && now - at < 24 * 3600 * 1000; };
  const uids = members.map((m) => m.name.split("/").pop()!).filter((uid) => !fresh(uid));
  const attempts: AttemptRow[] = [];
  for (let i = 0; i < uids.length; i += 8) attempts.push(...(await Promise.all(uids.slice(i, i + 8).map((uid) => attemptsOf(base, token, uid, since)))).flat());
  const figures = weeklyFigures(attempts, questionCount, now);
  const rows = members.map((m) => {
    const uid = m.name.split("/").pop()!;
    const n = nick.get(uid);
    const f = fresh(uid)
      ? { week: { questions: num(n?.count) ?? 0, sets: num(n?.sets) ?? 0 }, last: { questions: num(n?.prevCount) ?? 0, sets: num(n?.prevSets) ?? 0 } }
      : figures.get(uid) ?? { week: { questions: 0, sets: 0 }, last: { questions: 0, sets: 0 } };
    return { uid, name: (str(m.fields?.name) || "").trim().split(/\s+/)[0] || str(n?.name) || "Student", email: str(m.fields?.email), photo: str(m.fields?.photo) || str(n?.photo), nickname: str(n?.name), joined: n?.visible?.booleanValue === true, questions: f.week.questions, sets: f.week.sets, prevQuestions: f.last.questions, prevSets: f.last.sets, lastSeenAt: num(m.fields?.lastSeenAt) };
  }).sort((a, b) => b.questions - a.questions || a.name.localeCompare(b.name));
  const body: CacheBody = { at: now, week: weekStart(now), accounts: rows.length, rowsWithEmail: rows };
  cache = body;
  await store.setJSON(CACHE_KEY, body).catch(() => undefined);
  return respond(body);
}

/** The ISO week id, matching what devices write on their rows. */
function weekKey(ts: number): string {
  const d = new Date(weekStart(ts));
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3);
  const year = thursday.getFullYear();
  const firstWeekStart = weekStart(new Date(year, 0, 4).getTime());
  const week = Math.round((weekStart(thursday.getTime()) - firstWeekStart) / (7 * 24 * 3600 * 1000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export const config: Config = { path: "/api/progress" };
