import { db, getSettings, patchSettings } from "../data/db";
import type { AmbossPhraseGroup, AmbossPhrases } from "../data/types";
import type { Term } from "./ambossMatch";

export class AmbossAuthError extends Error {}

const NOT_AUTHORIZED = "permission.user_is_not_authorized";
const WRONG_CREDENTIALS = "access_denied.credentials_are_wrong";
const PHRASES_TTL = 30 * 24 * 3600 * 1000;
const GROUP_TTL = 7 * 24 * 3600 * 1000;

async function call<T>(body: Record<string, unknown>, token?: string): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-amboss-token"] = token;
  const res = await fetch("/api/amboss", { method: "POST", headers, body: JSON.stringify(body) });
  if (res.status === 401) throw new AmbossAuthError("Not logged in to AMBOSS.");
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; path?: (string | number)[] }[];
}

function unauthorized(errors?: { message: string }[]): boolean {
  return !!errors?.some((e) => e.message === NOT_AUTHORIZED || e.message === WRONG_CREDENTIALS);
}

export async function ambossLogin(username: string, password: string): Promise<{ eid: string; firstName?: string }> {
  const r = await call<GraphQLResponse<{ login: { token: string; user: { eid: string; firstName?: string } } | null }>>({
    action: "login",
    username,
    password,
  });
  if (!r.data?.login?.token) {
    const msg = r.errors?.[0]?.message ?? "Login failed.";
    throw new AmbossAuthError(msg === WRONG_CREDENTIALS ? "Wrong AMBOSS email or password." : msg);
  }
  const { token, user } = r.data.login;
  await patchSettings({ ambossToken: token, ambossUser: user });
  void refreshAccess();
  return user;
}

export async function ambossLogout(): Promise<void> {
  await patchSettings({ ambossToken: undefined, ambossUser: undefined, ambossAccess: undefined });
  await db.transaction("rw", db.ambossPhrases, db.ambossGroups, async () => {
    await db.ambossPhrases.clear();
    await db.ambossGroups.clear();
  });
}

async function token(): Promise<string> {
  const t = (await getSettings()).ambossToken;
  if (!t) throw new AmbossAuthError("Not logged in to AMBOSS.");
  return t;
}

/** Verify the token still works, mirroring the add-on's checkAnkiToken probe. Logs out on rejection. */
export async function ambossCheck(): Promise<boolean> {
  const r = await call<GraphQLResponse<{ currentUser: { eid: string } | null }>>({ action: "check" }, await token());
  if (r.data?.currentUser?.eid) return true;
  if (unauthorized(r.errors)) await ambossLogout();
  return false;
}

export async function refreshAccess(): Promise<string | undefined> {
  try {
    const r = await call<{ target?: string }>({ action: "access" }, await token());
    if (r.target) await patchSettings({ ambossAccess: r.target });
    return r.target;
  } catch {
    return undefined;
  }
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
  const r = await call<{ results?: PhraseResult[]; error?: string }>({ action: "phrases", texts: clean, guid: key }, await token());
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

/** The popup payload for a phrase group, cached by eid. */
export async function ambossPhraseGroup(eid: string): Promise<AmbossPhraseGroup> {
  const cached = await db.ambossGroups.get(eid);
  if (cached && Date.now() - cached.fetchedAt < GROUP_TTL) return cached;
  const r = await call<GraphQLResponse<{ phraseGroup: RawGroup | null }>>({ action: "phraseGroup", eid }, await token());
  if (unauthorized(r.errors) && !r.data?.phraseGroup) {
    await ambossLogout();
    throw new AmbossAuthError("AMBOSS session expired. Log in again in Settings.");
  }
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
  const utm = `utm_source=anki&utm_medium=anki&utm_campaign=anki&utm_term=${encodeURIComponent(term)}`;
  if (access === "public_article" && d.publicUrl) return `${d.publicUrl}${d.publicUrl.includes("?") ? "&" : "?"}${utm}`;
  if (d.articleEid) return `https://next.amboss.com/us/article/${d.articleEid}${d.anchor ? `#${d.anchor}` : ""}?${utm}`;
  if (d.publicUrl) return d.publicUrl;
  return null;
}
