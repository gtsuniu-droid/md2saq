import type { Context } from "@netlify/functions";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { firebaseEnv } from "../functions/mcp-token";
import { importRecords, joinNicknamed, readRecords } from "./board";
import { hosted, openNamedStore } from "./store";
import { CACHE_KEY, RECOUNT_MS, fromRecord, sortRows, weekStart, weeklyFigures, type AttemptRow, type CacheBody, type Pair, type Rec, type Row } from "./progress";

/**
 * The full count: every account's weekly figures added up from its submitted attempts with a
 * Firebase service account, so the Admin table is complete whether or not a student has
 * opened the site. Needs FIREBASE_SERVICE_ACCOUNT (the key's JSON) on Netlify, or in
 * .env.local when developing.
 *
 * It costs a Firestore read per answer, and the free plan's reads are a daily budget, so it
 * runs rarely: when an admin opens the table and the last count is an hour old, or in the
 * background after a board read once the last count is twelve hours old.
 */
export interface ServiceAccount { client_email: string; private_key: string; project_id: string }
export type FsValue = { stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean; mapValue?: { fields?: Record<string, FsValue> }; arrayValue?: { values?: FsValue[] }; timestampValue?: string; nullValue?: null };
export type FsDoc = { name: string; fields?: Record<string, FsValue> };

export function serviceAccount(): ServiceAccount | null {
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
export async function accessToken(sa: ServiceAccount): Promise<string> {
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

export const num = (v?: FsValue): number | undefined => v?.integerValue !== undefined ? Number(v.integerValue) : v?.doubleValue !== undefined ? v.doubleValue : v?.timestampValue ? Date.parse(v.timestampValue) : undefined;
export const str = (v?: FsValue): string | undefined => v?.stringValue;

export async function listAll(base: string, token: string, path: string): Promise<FsDoc[]> {
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
    // Nothing written in any part: a set clicked through, which counts for nothing.
    const answers = f.answers?.arrayValue?.values ?? [];
    if (answers.length && answers.every((v) => !(str(v.mapValue?.fields?.text) ?? "").trim())) return [];
    const qref = f.qref?.mapValue?.fields;
    return [{ uid, submittedAt, questionId: str(f.questionId) ?? "", bankId: str(qref?.bankId), order: num(qref?.order) }];
  });
}

/**
 * Each device publishes a small record (nickname, photo, joined flag, its own counts). The
 * server adds up every account's submitted answers and the higher of that and the record
 * wins. Throws when Firestore cannot be read; the table in the store is then left as it was.
 */
export async function recount(posted: Map<string, Rec>, now = Date.now()): Promise<CacheBody> {
  const sa = serviceAccount();
  if (!sa) throw new Error("Server-side progress is not configured: add FIREBASE_SERVICE_ACCOUNT to the site's environment.");
  const store = openNamedStore("bank");
  const { projectId } = firebaseEnv();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId ?? sa.project_id}/databases/(default)/documents`;
  const index = (await store.get("index", { type: "json" })) as { id: string; questionCount: number }[] | null;
  const token = await accessToken(sa);
  const [members, board] = await Promise.all([listAll(base, token, "members"), listAll(base, token, "leaderboard")]);
  const questionCount = new Map((index ?? []).map((e) => [e.id, e.questionCount]));
  const since = weekStart(now) - 7 * 24 * 3600 * 1000;
  // Firestore's records go into the site's table first, before the answer reads that may run
  // out of budget: from then on everyone who joined is listed whatever Firestore can do.
  const fromFirestore = new Map<string, Rec>(board.filter((d) => d.fields).map((d) => [d.name.split("/").pop()!, recordOf(d.fields!)]));
  posted = await importRecords(fromFirestore).catch((e) => { console.warn("progress: records not imported:", e); return posted; });
  // A student who chose a nickname meant to be seen, whatever the join box said at the time.
  posted = await joinNicknamed(new Map(members.map((m) => [m.name.split("/").pop()!, str(m.fields?.name)]))).catch((e) => { console.warn("progress: nicknames not joined:", e); return posted; });
  // Each account's record: the newer of what its device wrote to Firestore and what it posted
  // here, except that whether it is on the board, and under what name, is always the site's own record's say.
  const nick = new Map(fromFirestore);
  for (const [uid, r] of posted) { const cur = nick.get(uid); nick.set(uid, !cur || r.at > cur.at ? r : { ...cur, visible: r.visible, name: r.name }); }
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
      } catch (e) {
        // Out of reads partway: give up rather than save a table missing everyone after this point.
        if (e instanceof Error && e.message.includes("(429)")) throw e;
        figures.set(uid, { pair: fromRecord(nick.get(uid), now), source: nick.has(uid) ? "device" : "none" });
      }
    }));
  }
  const rows: Row[] = members.map((m) => {
    const uid = m.name.split("/").pop()!;
    const n = nick.get(uid);
    const { pair: f, source } = figures.get(uid) ?? { pair: { week: { questions: 0, sets: 0 }, last: { questions: 0, sets: 0 } } as Pair, source: "none" as const };
    return { uid, name: (str(m.fields?.name) || "").trim().split(/\s+/)[0] || n?.name || "Student", email: str(m.fields?.email), photo: str(m.fields?.photo) || n?.photo, nickname: n?.name, joined: n !== undefined && n.visible !== false, questions: f.week.questions, sets: f.week.sets, prevQuestions: f.last.questions, prevSets: f.last.sets, total: n?.total ?? 0, totalSets: n?.totalSets ?? 0, lastSeenAt: num(m.fields?.lastSeenAt), source };
  });
  sortRows(rows);
  const body: CacheBody = { at: now, week: weekStart(now), accounts: rows.length, rowsWithEmail: rows };
  await store.setJSON(CACHE_KEY, body);
  return body;
}

/**
 * After a board read: start a full count in the background when the last one is old, at most
 * once every half hour across all visitors, so a spent read budget is not retried on every visit.
 */
export function recountLater(last: CacheBody | null, context: Context | undefined): void {
  const now = Date.now();
  if (!context?.waitUntil || !serviceAccount()) return;
  if (last && last.week === weekStart(now) && now - last.at < RECOUNT_MS) return;
  context.waitUntil((async () => {
    const claimed = await openNamedStore("bank").update<number>("progress-tried", (t) => (t && now - t < 30 * 60_000 ? null : now));
    if (claimed === null) return;
    await recount(await readRecords(), now);
  })().catch((e) => console.warn("progress: background count failed:", e)));
}

/** A Firestore leaderboard document as a record. Records from before the joined flag existed count as joined. */
function recordOf(f: Record<string, FsValue>): Rec {
  return { name: str(f.name), photo: str(f.photo), visible: f.visible?.booleanValue, week: str(f.week) ?? "", count: num(f.count) ?? 0, sets: num(f.sets) ?? 0, prevCount: num(f.prevCount) ?? 0, prevSets: num(f.prevSets) ?? 0, total: num(f.total), totalSets: num(f.totalSets), at: num(f.updatedAt) ?? 0 };
}
