import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

/**
 * The account a Firebase ID token belongs to, checked here against Google's published signing
 * keys rather than by asking Google on every request. The keys are fetched once and kept for
 * as long as Google says they stay valid, so a warm function verifies with no network at all.
 * Enough where only the uid matters; `caller` is still the check for anything role-bound.
 */
const CERTS = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let keys: { byKid: Map<string, KeyObject>; expires: number; fetchedAt: number } | null = null;

async function signingKeys(fresh = false): Promise<Map<string, KeyObject>> {
  // A forced look is allowed once a minute, so made-up key ids cannot make every request fetch.
  if (keys && keys.expires > Date.now() && (!fresh || Date.now() - keys.fetchedAt < 60_000)) return keys.byKid;
  const res = await fetch(CERTS);
  if (!res.ok) throw new Error(`Google's signing keys could not be fetched (${res.status}).`);
  const certs = (await res.json()) as Record<string, string>;
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  keys = { byKid: new Map(Object.entries(certs).map(([kid, pem]) => [kid, createPublicKey(pem)])), expires: Date.now() + maxAge * 1000, fetchedAt: Date.now() };
  return keys.byKid;
}

/** The uid in a valid ID token for this project, or null when the token is missing, forged, expired or for another project. */
export async function verifiedUid(req: Request, projectId: string): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const [h, p, sig] = token?.split(".") ?? [];
  if (!h || !p || !sig) return null;
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg?: string; kid?: string };
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as { aud?: string; iss?: string; sub?: string; exp?: number; iat?: number };
    const now = Date.now() / 1000;
    if (header.alg !== "RS256" || !header.kid) return null;
    if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!claims.sub || !claims.exp || claims.exp < now || (claims.iat ?? 0) > now + 300) return null;
    // A key id not seen yet: Google may have rotated early, so look once more.
    const key = (await signingKeys()).get(header.kid) ?? (await signingKeys(true)).get(header.kid);
    if (!key) return null;
    return createVerify("RSA-SHA256").update(`${h}.${p}`).verify(key, sig, "base64url") ? claims.sub : null;
  } catch { return null; }
}
