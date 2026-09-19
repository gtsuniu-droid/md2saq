import type { Config } from "@netlify/functions";

/**
 * Relay for the AMBOSS endpoints the official Anki add-on uses. A browser page
 * cannot call them directly (no CORS), so the site sends its requests here with
 * the user's own AMBOSS token and this function forwards them unchanged.
 * Nothing is stored server-side.
 */
const GATEWAY = "https://content-gateway.us.production.amboss.com";
const PHRASES = "https://anki.us.production.amboss.com/v1/anki/";
const ACCESS = "https://anki.us.production.amboss.com/v1/access/article/";
const USER_AGENT = "AMBOSS Anki add-on (AMBOSS v0.10.0; Anki v25.02); md2saq";

const LOGIN = `mutation ankiLogin($username: String!, $password: String!, $deviceId: String!) {
  login(login: $username, password: $password, deviceId: $deviceId) {
    token
    user { eid firstName }
  }
}`;
const CHECK = `query checkAnkiToken { currentUser { eid } }`;
const PHRASE_GROUP = (eid: string) => `query AnkiPhraseGroup {
  phraseGroup(eid: ${JSON.stringify(eid)}) {
    eid title synonyms abstract translation
    destinations { label articleEid anchor publicUrl }
    media { eid title canonicalUrl aspectRatio copyright { html } }
  }
}`;

type Body =
  | { action: "login"; username: string; password: string }
  | { action: "check" }
  | { action: "access" }
  | { action: "phrases"; texts: string[]; guid: string }
  | { action: "phraseGroup"; eid: string };

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

async function graphql(query: string, operationName: string, variables: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": USER_AGENT };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(GATEWAY, { method: "POST", headers, body: JSON.stringify({ query, operationName, variables }) });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON upstream error */ }
  return { status: res.status, body: parsed ?? { errors: [{ message: text.slice(0, 300) }] }, rateLimit: rateLimit(res) };
}

function rateLimit(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of ["x-amboss-ratelimit-limit", "x-amboss-ratelimit-remaining", "x-amboss-ratelimit-reset"]) {
    const v = res.headers.get(h);
    if (v) out[h] = v;
  }
  return out;
}

async function rest(url: string, token: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT, authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, body: parsed ?? { error: text.slice(0, 300) }, rateLimit: rateLimit(res) };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Body must be JSON.", { status: 400 });
  }
  const token = req.headers.get("x-amboss-token") ?? "";

  try {
    if (body.action === "login") {
      if (!body.username || !body.password) return new Response("Missing credentials.", { status: 400 });
      const r = await graphql(LOGIN, "ankiLogin", { username: body.username, password: body.password, deviceId: "anki" });
      return json(r.body, r.status, r.rateLimit);
    }
    if (!token) return new Response("Not logged in to AMBOSS.", { status: 401 });
    if (body.action === "check") {
      const r = await graphql(CHECK, "checkAnkiToken", {}, token);
      return json(r.body, r.status, r.rateLimit);
    }
    if (body.action === "access") {
      const r = await rest(ACCESS, token, {});
      return json(r.body, r.status, r.rateLimit);
    }
    if (body.action === "phrases") {
      if (!Array.isArray(body.texts) || body.texts.length === 0) return new Response("Missing texts.", { status: 400 });
      const r = await rest(PHRASES, token, { card_text_list: body.texts.slice(0, 50).map((t) => String(t).slice(0, 20000)), guid: String(body.guid ?? "") });
      return json(r.body, r.status, r.rateLimit);
    }
    if (body.action === "phraseGroup") {
      if (!body.eid) return new Response("Missing eid.", { status: 400 });
      const r = await graphql(PHRASE_GROUP(String(body.eid)), "AnkiPhraseGroup", {}, token);
      return json(r.body, r.status, r.rateLimit);
    }
    return new Response("Unknown action.", { status: 400 });
  } catch (e) {
    return new Response(`AMBOSS unreachable: ${e instanceof Error ? e.message : String(e)}`, { status: 502 });
  }
};

export const config: Config = { path: "/api/amboss" };
