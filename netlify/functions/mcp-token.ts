import type { Config } from "@netlify/functions";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hosted, openNamedStore } from "../lib/store";
import { OWNER_EMAIL } from "../../src/lib/owner";

/**
 * Personal connection links for Claude. A signed-in person asks for a link; the
 * function checks their Firebase sign-in, records who they are and whether they
 * are an admin, and returns a URL carrying a random token. /api/mcp/<token>
 * then serves MCP for that person. Only the token's hash is stored, so a link
 * is shown once; a new one replaces the old.
 */
export interface ConnectionRecord {
  uid: string;
  email: string;
  name?: string;
  role: "owner" | "admin" | "student";
  createdAt: number;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Firebase web config, from the environment on Netlify or from .env.local when developing. */
export function firebaseEnv(): { apiKey?: string; projectId?: string; adminEmails: string[] } {
  const env: Record<string, string | undefined> = { ...process.env };
  if (!hosted()) {
    try {
      for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* no .env.local */ }
  }
  return { apiKey: env.VITE_FIREBASE_API_KEY, projectId: env.VITE_FIREBASE_PROJECT_ID, adminEmails: (env.VITE_ADMIN_EMAILS || OWNER_EMAIL).split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean) };
}

/** Who is calling, from the Firebase ID token in the Authorization header. */
export async function caller(req: Request): Promise<ConnectionRecord | Response> {
  const idToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return new Response("Sign in first.", { status: 401 });
  const { apiKey, projectId, adminEmails } = firebaseEnv();
  if (!apiKey || !projectId) return new Response("Sign-in is not configured on this site.", { status: 503 });
  const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  if (!lookup.ok) return new Response("Your sign-in could not be verified. Sign in again.", { status: 401 });
  const user = ((await lookup.json()) as { users?: { localId: string; email?: string; emailVerified?: boolean; displayName?: string }[] }).users?.[0];
  if (!user?.email) return new Response("Your sign-in could not be verified.", { status: 401 });
  if (!user.emailVerified) return new Response("Confirm your email address before connecting Claude.", { status: 403 });
  const email = user.email.toLowerCase();
  let role: ConnectionRecord["role"] = email === OWNER_EMAIL ? "owner" : adminEmails.includes(email) ? "admin" : "student";
  if (role === "student") {
    // The admin role granted from the People list lives in Firestore; the person may read their own record.
    const doc = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/members/${user.localId}`, { headers: { authorization: `Bearer ${idToken}` } });
    if (doc.ok) {
      const data = (await doc.json()) as { fields?: { role?: { stringValue?: string } } };
      if (data.fields?.role?.stringValue === "admin") role = "admin";
    }
  }
  return { uid: user.localId, email, name: user.displayName, role, createdAt: Date.now() };
}

export default async (req: Request): Promise<Response> => {
  const store = openNamedStore("mcp-tokens");
  const who = await caller(req);
  if (who instanceof Response) return who;
  const url = new URL(req.url);
  const userKey = `users/${who.uid}`;
  const existing = (await store.get(userKey, { type: "json" })) as { hash: string; createdAt: number } | null;

  if (req.method === "GET") {
    return json({ connected: !!existing, createdAt: existing?.createdAt ?? null, role: who.role });
  }
  if (req.method === "DELETE") {
    if (existing) { await store.delete(`tokens/${existing.hash}`); await store.delete(userKey); }
    return json({ connected: false, role: who.role });
  }
  if (req.method === "POST") {
    if (existing) await store.delete(`tokens/${existing.hash}`);
    const token = randomBytes(24).toString("base64url");
    const hash = hashToken(token);
    await store.setJSON(`tokens/${hash}`, who);
    await store.setJSON(userKey, { hash, createdAt: who.createdAt });
    return json({ connected: true, createdAt: who.createdAt, role: who.role, url: `${url.origin}/api/mcp/${token}` }, 201);
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/mcp-token" };
