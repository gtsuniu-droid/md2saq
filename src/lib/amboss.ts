import { db, getSettings, patchSettings } from "../data/db";
import type { AmbossPhraseGroup, AmbossPhrases } from "../data/types";
import type { Term } from "./ambossMatch";
import { decryptAmbossPassword, encryptAmbossLogin } from "./ambossCredentials";

export class AmbossAuthError extends Error {}

const NOT_AUTHORIZED = "permission.user_is_not_authorized";
const WRONG_CREDENTIALS = "access_denied.credentials_are_wrong";
const PHRASES_TTL = 30 * 24 * 3600 * 1000;
const GROUP_TTL = 7 * 24 * 3600 * 1000;
let sessionEpoch = 0;
let reconnecting: Promise<string> | null = null;

async function call<T>(body: Record<string, unknown>, token?: string): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-amboss-token"] = token;
  const res = await fetch("/api/amboss", { method: "POST", headers, body: JSON.stringify(body) });
  if (res.status === 401) throw new AmbossAuthError(body.action === "login" ? "AMBOSS could not sign in. Check your email and password in Settings." : "AMBOSS session expired.");
  if (!res.ok) throw new Error(res.status === 429 ? "AMBOSS is busy. Please try again shortly." : `Could not reach AMBOSS (${res.status}). Try again when your connection is available.`);
  return (await res.json()) as T;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; path?: (string | number)[] }[];
}
interface LoginResult { token: string; user: { eid: string; firstName?: string } }

function unauthorized(errors?: { message: string }[]): boolean {
  return !!errors?.some((e) => e.message === NOT_AUTHORIZED || e.message === WRONG_CREDENTIALS);
}

async function requestLogin(username: string, password: string): Promise<LoginResult> {
  const r = await call<GraphQLResponse<{ login: LoginResult | null }>>({ action: "login", username, password });
  if (!r.data?.login?.token) {
    if (r.errors?.some((e) => /rate.?limit|temporar|unavailable/i.test(e.message))) throw new Error("AMBOSS sign-in is temporarily unavailable. Try again shortly.");
    throw new AmbossAuthError("AMBOSS could not sign in. Check your email and password in Settings.");
  }
  return r.data.login;
}

/** Remembering is explicit; successful manual sign-in replaces any saved account. */
export async function ambossLogin(username: string, password: string, remember = false): Promise<LoginResult["user"]> {
  const epoch = ++sessionEpoch;
  const saved = remember ? await encryptAmbossLogin(username, password) : null;
  const result = await requestLogin(username.trim(), password);
  await db.transaction("rw", db.settings, db.deviceLogins, db.ambossPhrases, db.ambossGroups, async () => {
    if (epoch !== sessionEpoch) throw new AmbossAuthError("Sign-in was cancelled.");
    const previous = await getSettings();
    if (previous.ambossUser?.eid !== result.user.eid) {
      await db.ambossPhrases.clear(); await db.ambossGroups.clear();
    }
    if (saved) await db.deviceLogins.put({ ...saved, userId: result.user.eid });
    else await db.deviceLogins.delete("amboss");
    await patchSettings({ ambossToken: result.token, ambossUser: result.user, ambossAccess: undefined });
  });
  void refreshAccess();
  return result.user;
}

/** An explicit logout also forgets the password, so it cannot immediately sign back in. */
export async function ambossLogout(): Promise<void> {
  sessionEpoch++;
  await db.transaction("rw", db.settings, db.deviceLogins, db.ambossPhrases, db.ambossGroups, async () => {
    await db.deviceLogins.delete("amboss");
    await patchSettings({ ambossToken: undefined, ambossUser: undefined, ambossAccess: undefined });
    await db.ambossPhrases.clear(); await db.ambossGroups.clear();
  });
}

async function reconnect(failedToken?: string): Promise<string> {
  if (reconnecting) return reconnecting;
  const epoch = sessionEpoch;
  const renew = async () => {
    const current = await getSettings();
    if (epoch !== sessionEpoch) throw new AmbossAuthError("Sign-in was cancelled.");
    // Another request or tab may already have renewed this token.
    if (current.ambossToken && current.ambossToken !== failedToken) return current.ambossToken;
    const saved = await db.deviceLogins.get("amboss");
    if (!saved || saved.blocked) throw new AmbossAuthError(saved ? "Automatic AMBOSS sign-in needs attention. Update your saved login in Settings." : "Log in to AMBOSS in Settings.");
    if ((saved.retryAfter ?? 0) > Date.now()) throw new Error("AMBOSS reconnection is paused briefly. Try again shortly.");
    if (current.ambossUser?.eid && current.ambossUser.eid !== saved.userId) throw new AmbossAuthError("Update your saved AMBOSS login in Settings for this account.");
    try {
      let password: string;
      try { password = await decryptAmbossPassword(saved); }
      catch { throw new AmbossAuthError("This browser could not read the saved login. Save it again in AMBOSS Settings."); }
      const result = await requestLogin(saved.username, password);
      if (result.user.eid !== saved.userId) throw new AmbossAuthError("The saved AMBOSS account has changed. Update it in Settings.");
      await db.transaction("rw", db.settings, db.deviceLogins, async () => {
        const latest = await db.deviceLogins.get("amboss");
        if (epoch !== sessionEpoch || latest?.revision !== saved.revision) throw new AmbossAuthError("Automatic sign-in was cancelled.");
        await patchSettings({ ambossToken: result.token, ambossUser: result.user });
        await db.deviceLogins.put({ ...latest, retryAfter: undefined, blocked: false });
      });
      return result.token;
    } catch (error) {
      await db.transaction("rw", db.settings, db.deviceLogins, async () => {
        const latest = await db.deviceLogins.get("amboss");
        if (epoch !== sessionEpoch || latest?.revision !== saved.revision) return;
        await db.deviceLogins.put({ ...latest, blocked: error instanceof AmbossAuthError, retryAfter: Date.now() + 60_000 });
      });
      throw error;
    }
  };
  // Web Locks also coalesces reauthentication between windows on this browser.
  const job = (async () => typeof navigator !== "undefined" && navigator.locks ? await navigator.locks.request("saq-amboss-login", renew) : await renew())();
  reconnecting = job.finally(() => { reconnecting = null; });
  return reconnecting;
}

async function checkedCall<T>(body: Record<string, unknown>, token: string): Promise<T> {
  const result = await call<T>(body, token);
  const r = result as GraphQLResponse<{ phraseGroup?: unknown; currentUser?: unknown }> & { error?: string };
  const missingProtectedData = body.action === "check" ? !r.data?.currentUser : body.action === "phraseGroup" ? !r.data?.phraseGroup : true;
  // A partial article may be a membership restriction, not an expired session.
  if (missingProtectedData && (unauthorized(r.errors) || r.error === NOT_AUTHORIZED || r.error === WRONG_CREDENTIALS || (body.action === "check" && !r.errors?.length))) throw new AmbossAuthError("AMBOSS session expired.");
  return result;
}

async function rejectToken(token: string): Promise<void> {
  await db.transaction("rw", db.settings, db.deviceLogins, async () => {
    const settings = await getSettings();
    if (settings.ambossToken !== token) return;
    const saved = await db.deviceLogins.get("amboss");
    if (saved) await db.deviceLogins.put({ ...saved, blocked: true });
    await patchSettings({ ambossToken: undefined, ambossUser: undefined, ambossAccess: undefined });
  });
}

/** Retry the interrupted lookup once after reconnecting, without repeated login attempts. */
async function authenticatedCall<T>(body: Record<string, unknown>): Promise<T> {
  const existing = (await getSettings()).ambossToken;
  const initial = existing ?? await reconnect();
  try { return await checkedCall<T>(body, initial); }
  catch (error) {
    if (!(error instanceof AmbossAuthError)) throw error;
    if (!existing) { await rejectToken(initial); throw error; }
    const renewed = await reconnect(initial);
    try { return await checkedCall<T>(body, renewed); }
    catch (retryError) {
      if (retryError instanceof AmbossAuthError) await rejectToken(renewed);
      throw retryError;
    }
  }
}

/** Restore a missing session on entry/reconnection; no polling or periodic login. */
export async function restoreAmbossSession(): Promise<void> {
  if (!(await getSettings()).ambossToken && await db.deviceLogins.get("amboss")) await reconnect();
}

export async function ambossCheck(): Promise<boolean> {
  try {
    const r = await authenticatedCall<GraphQLResponse<{ currentUser: { eid: string } | null }>>({ action: "check" });
    return !!r.data?.currentUser?.eid;
  } catch (error) {
    if (error instanceof AmbossAuthError) return false;
    throw error;
  }
}

export async function refreshAccess(): Promise<string | undefined> {
  try {
    const r = await authenticatedCall<{ target?: string }>({ action: "access" });
    if (r.target) await patchSettings({ ambossAccess: r.target });
    return r.target;
  } catch { return undefined; }
}

interface PhraseResult {
  term: string;
  pg_id: string;
}

/** Terms found in the given texts, cached per key (normally the question id). */
export async function ambossPhrases(key: string, texts: string[]): Promise<Term[]> {
  const cached = await db.ambossPhrases.get(key);
  if (cached && Date.now() - cached.fetchedAt < PHRASES_TTL) return cached.terms;
  const clean = texts.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return [];
  const r = await authenticatedCall<{ results?: PhraseResult[]; error?: string }>({ action: "phrases", texts: clean, guid: key });
  if (r.error) throw new Error("AMBOSS could not find references. Please try again.");
  const seen = new Set<string>();
  const terms: Term[] = [];
  for (const x of r.results ?? []) {
    if (!x.term || !x.pg_id || seen.has(x.term.toLowerCase())) continue;
    seen.add(x.term.toLowerCase());
    terms.push({ term: x.term, pgId: x.pg_id });
  }
  const row: AmbossPhrases = { key, terms, fetchedAt: Date.now() };
  await db.ambossPhrases.put(row);
  return terms;
}

interface RawGroup {
  eid: string;
  title: string;
  synonyms?: string[] | null;
  abstract?: string | null;
  translation?: string | null;
  destinations?: AmbossPhraseGroup["destinations"] | null;
  media?: AmbossPhraseGroup["media"] | null;
}

const groupRequests = new Map<string, Promise<AmbossPhraseGroup>>();

/** Hovering and clicking the same term share one lookup, then use its cached result. */
export function ambossPhraseGroup(eid: string): Promise<AmbossPhraseGroup> {
  let request = groupRequests.get(eid);
  if (!request) {
    request = loadAmbossPhraseGroup(eid).finally(() => groupRequests.delete(eid));
    groupRequests.set(eid, request);
  }
  return request;
}

async function loadAmbossPhraseGroup(eid: string): Promise<AmbossPhraseGroup> {
  const cached = await db.ambossGroups.get(eid);
  if (cached && Date.now() - cached.fetchedAt < GROUP_TTL) return cached;
  const r = await authenticatedCall<GraphQLResponse<{ phraseGroup: RawGroup | null }>>({ action: "phraseGroup", eid });
  const g = r.data?.phraseGroup;
  if (!g) throw new Error(r.errors?.[0]?.message ?? "No content for this term.");
  const paywalled = !!r.errors?.some((e) => e.message === NOT_AUTHORIZED || e.path?.[e.path.length - 1] === "abstract");
  const group: AmbossPhraseGroup = {
    eid: g.eid,
    title: g.title,
    synonyms: g.synonyms ?? [],
    abstract: g.abstract ?? null,
    translation: g.translation ?? null,
    destinations: g.destinations ?? [],
    media: g.media ?? [],
    paywalled,
    fetchedAt: Date.now(),
  };
  await db.ambossGroups.put(group);
  return group;
}

/** Article link for a destination, following the add-on's access-tier rule. */
export function destinationUrl(
  d: AmbossPhraseGroup["destinations"][number],
  access: string | undefined,
  term: string,
): string | null {
  const publicUrl = safeAmbossUrl(d.publicUrl);
  const article = d.articleEid ? new URL(`https://next.amboss.com/us/article/${encodeURIComponent(d.articleEid)}`) : null;
  if (article && d.anchor) article.hash = d.anchor;
  const chosen = access === "public_article" && publicUrl ? new URL(publicUrl) : article ?? (publicUrl ? new URL(publicUrl) : null);
  if (!chosen) return null;
  // Query parameters must precede the fragment, otherwise section links break.
  chosen.searchParams.set("utm_source", "anki");
  chosen.searchParams.set("utm_medium", "anki");
  chosen.searchParams.set("utm_campaign", "anki");
  chosen.searchParams.set("utm_term", term);
  return chosen.href;
}

export function safeAmbossUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && (url.hostname === "amboss.com" || url.hostname.endsWith(".amboss.com")) ? url.href : null;
  } catch { return null; }
}
