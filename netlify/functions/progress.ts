import type { Config } from "@netlify/functions";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { caller, firebaseEnv } from "./mcp-token";
import { hosted, openNamedStore } from "../lib/store";
import { CACHE_KEY, CACHE_MS, fromRecord, publicBoard, sortRows, staleTable, weekStart, weeklyFigures, type AttemptRow, type CacheBody, type Pair, type Rec, type Row } from "../lib/progress";
import type { BoardRecord } from "../lib/progress";

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
 * The logic: each device publishes a small record on every sync (nickname, photo, joined
 * flag, its own counts). The server adds up every account's submitted answers and that
 * figure wins; an account's record stands in only when the server cannot read its answers.
 * Reads are the scarce resource (the free Firestore quota is a daily budget), so the result
 * is cached for every visitor in the bank's blob store for ten minutes. Records posted to
 * /api/board in the meantime are laid over that stored table as they arrive, so it is re-read
 * from the store every few seconds rather than trusted from memory.
 */
let cache: CacheBody | null = null;
let loadedAt = 0;

export default async (req: Request): Promise<Response> => {
  try { return await handle(req); }
  catch (e) { console.error("progress:", e); return json({ error: `Progress could not be computed: ${e instanceof Error ? e.message : String(e)}` }, 500); }
};

async function handle(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  // ?board=1 is the public leaderboard: anyone, signed in or not; joined accounts only, nicknames
  // only. It shows the same to everyone, so the sign-in is not checked (that costs two calls to Google).
  const isBoard = new URL(req.url).searchParams.has("board");
  const who: { role: "owner" | "admin" | "student" } | Response = isBoard ? { role: "student" } : await caller(req);
  if (who instanceof Response) return who;
  if (who.role === "student" && !isBoard) return json({ error: "Admins only." }, 403);
  const sa = serviceAccount();
  if (!sa) return json({ error: "Server-side progress is not configured: add FIREBASE_SERVICE_ACCOUNT to the site's environment." }, 503);
  const respond = (body: CacheBody) => {
    if (isBoard) return json(publicBoard(body));
    const state = body.stale ? { stale: true, asOf: body.asOf, reason: body.reason } : {};
    return json({ week: body.week, ...state, accounts: body.accounts, emailsIncluded: who.role === "owner", rows: who.role === "owner" ? body.rowsWithEmail : body.rowsWithEmail.map((r) => ({ ...r, email: undefined })) });
  };
  const store = openNamedStore("bank");
  const now = Date.now();
  if (!cache || now - loadedAt >= 5_000) { cache = ((await store.get(CACHE_KEY, { type: "json" })) as CacheBody | null) ?? cache; loadedAt = now; }
  if (cache && now - cache.at < CACHE_MS && cache.week === weekStart(now)) return respond(cache);
  const { projectId } = firebaseEnv();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId ?? sa.project_id}/databases/(default)/documents`;
  // The records devices posted to the site's own store: readable whatever Firestore's budget says.
  const [posted, index] = await Promise.all([
    postedRecords().catch(() => new Map<string, Rec>()),
    store.get("index", { type: "json" }) as Promise<{ id: string; questionCount: number }[] | null>,
  ]);
  let token: string, members: FsDoc[], board: FsDoc[];
  try {
    token = await accessToken(sa);
    [members, board] = await Promise.all([listAll(base, token, "members"), listAll(base, token, "leaderboard")]);
  } catch (e) {
    // Firestore refused (its daily read budget, most likely). The last full table stands, brought
    // up to date with every record devices have posted here since it was made.
    console.warn("progress: Firestore unreadable, serving the last table:", e);
    return respond(staleTable(cache, posted, now, e instanceof Error ? e.message : String(e)));
  }
  const questionCount = new Map((index ?? []).map((e) => [e.id, e.questionCount]));
  const since = weekStart(now) - 7 * 24 * 3600 * 1000;
  // Each account's record: the newer of what its device wrote to Firestore and what it posted here.
  const nick = new Map<string, Rec>(board.filter((d) => d.fields).map((d) => [d.name.split("/").pop()!, recordOf(d.fields!)]));
  for (const [uid, r] of posted) { const cur = nick.get(uid); if (!cur || r.at > cur.at) nick.set(uid, r); }
  // Records written before the joined flag existed were all opt-ins: stamp the flag on them so
  // the board lists them through every path from now on, not only this one.
  await Promise.all(board.filter((d) => d.fields && d.fields.visible === undefined).map((d) =>
    fetch(`https://firestore.googleapis.com/v1/${d.name}?updateMask.fieldPaths=visible`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ fields: { visible: { booleanValue: true } } }) }).catch(() => undefined)));
  // Server first: add up each account's submitted answers. Per account, a failed read falls back to the record.
  const uids = members.map((m) => m.name.split("/").pop()!);
  const figures = new Map<string, { pair: Pair; source: "server" | "device" | "none" }>();
  for (let i = 0; i < uids.length; i += 8) {
    await Promise.all(uids.slice(i, i + 8).map(async (uid) => {
      try {
        const rows = await attemptsOf(base, token, uid, since);
        const f = weeklyFigures(rows, questionCount, now).get(uid) ?? { week: { questions: 0, sets: 0 }, last: { questions: 0, sets: 0 } };
        // A device posts its count as soon as the board is opened, which can be before its answers are synced.
        const d = fromRecord(nick.get(uid), now);
        const top = (a: Pair["week"], b: Pair["week"]) => ({ questions: Math.max(a.questions, b.questions), sets: Math.max(a.sets, b.sets) });
        figures.set(uid, { pair: { week: top(f.week, d.week), last: top(f.last, d.last) }, source: "server" });
      } catch {
        figures.set(uid, { pair: fromRecord(nick.get(uid), now), source: nick.has(uid) ? "device" : "none" });
      }
    }));
  }
  const rows: Row[] = members.map((m) => {
    const uid = m.name.split("/").pop()!;
    const n = nick.get(uid);
    const { pair: f, source } = figures.get(uid) ?? { pair: { week: { questions: 0, sets: 0 }, last: { questions: 0, sets: 0 } } as Pair, source: "none" as const };
    return { uid, name: (str(m.fields?.name) || "").trim().split(/\s+/)[0] || n?.name || "Student", email: str(m.fields?.email), photo: str(m.fields?.photo) || n?.photo, nickname: n?.name, joined: n !== undefined && n.visible !== false, questions: f.week.questions, sets: f.week.sets, prevQuestions: f.last.questions, prevSets: f.last.sets, lastSeenAt: num(m.fields?.lastSeenAt), source };
  });
  sortRows(rows);
  const body: CacheBody = { at: now, week: weekStart(now), accounts: rows.length, rowsWithEmail: rows };
  cache = body; loadedAt = now;
  await store.setJSON(CACHE_KEY, body).catch(() => undefined);
  return respond(body);
}

/** A Firestore leaderboard document as a record. Records from before the joined flag existed count as joined. */
function recordOf(f: Record<string, FsValue>): Rec {
  return { name: str(f.name), photo: str(f.photo), visible: f.visible?.booleanValue, week: str(f.week) ?? "", count: num(f.count) ?? 0, sets: num(f.sets) ?? 0, prevCount: num(f.prevCount) ?? 0, prevSets: num(f.prevSets) ?? 0, at: num(f.updatedAt) ?? 0 };
}

/** Every record devices posted to the site's own store, by account. */
async function postedRecords(): Promise<Map<string, Rec>> {
  const store = openNamedStore("board");
  const keys = await store.list("board/");
  const recs = await Promise.all(keys.map(async (k) => [k.slice("board/".length), (await store.get(k, { type: "json" })) as BoardRecord | null] as const));
  return new Map(recs.filter((r): r is readonly [string, BoardRecord] => !!r[1] && typeof r[1].at === "number"));
}

export const config: Config = { path: "/api/progress" };
