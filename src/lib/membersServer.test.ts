import { beforeEach, expect, it, vi } from "vitest";

const blobs = new Map<string, unknown>();
vi.mock("../../netlify/lib/store", () => ({
  hosted: () => false,
  openNamedStore: (name: string) => ({
    get: async (k: string) => blobs.get(`${name}/${k}`) ?? null,
    setJSON: async (k: string, v: unknown) => { blobs.set(`${name}/${k}`, v); },
    delete: async (k: string) => { blobs.delete(`${name}/${k}`); },
    list: async () => [],
    update: async <T,>(k: string, change: (c: T | null) => T | null | Promise<T | null>) => { const next = await change((blobs.get(`${name}/${k}`) as T) ?? null); if (next !== null) blobs.set(`${name}/${k}`, next); return next; },
  }),
}));
// "Bearer uid|email|verified" stands in for a signed ID token.
vi.mock("../../netlify/lib/idtoken", () => ({ verifiedUser: async (req: Request) => {
  const [uid, email, verified] = (req.headers.get("authorization")?.slice(7) ?? "").split("|");
  return uid ? { uid, email: email || undefined, verified: verified === "yes", name: `Name ${uid}` } : null;
} }));
vi.mock("../../netlify/functions/mcp-token", () => ({ firebaseEnv: () => ({ projectId: "p" }) }));
delete process.env.FIREBASE_SERVICE_ACCOUNT;

const members = (await import("../../netlify/functions/members")).default;
const { roleOf } = await import("../../netlify/lib/members");
const OWNER = "o1|gtsuniu@gmail.com|yes";
const call = async (as: string, init: RequestInit = {}, query = "") => {
  const res = await members(new Request(`http://x/api/members${query}`, { ...init, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => blobs.clear());

it("records a sign-in and answers with no role for a student", async () => {
  expect(await call("s1|s1@x.com|yes", { method: "POST" })).toEqual({ status: 200, body: { role: null } });
  expect((await call("s1|s1@x.com|yes", {}, "?list")).status).toBe(403);
  expect((await call("", { method: "POST" })).status).toBe(401);
});

it("the owner gives and takes the admin role, which the student and the connector then see", async () => {
  await call("s1|s1@x.com|yes", { method: "POST" });
  await call(OWNER, { method: "POST" });
  expect(await call(OWNER, { method: "PUT", body: JSON.stringify({ uid: "s1", admin: true }) })).toEqual({ status: 200, body: { role: "admin" } });
  expect((await call("s1|s1@x.com|yes")).body).toEqual({ role: "admin" });
  expect(await roleOf("s1")).toBe("admin");
  const list = (await call(OWNER, {}, "?list")).body.people as { uid: string; role?: string; name: string }[];
  expect(list.map((p) => [p.uid, p.role ?? null])).toEqual([["o1", null], ["s1", "admin"]]);
  expect(list[1].name).toBe("Name s1");
  expect(await call(OWNER, { method: "PUT", body: JSON.stringify({ uid: "s1", admin: false }) })).toEqual({ status: 200, body: { role: null } });
  expect((await call("s1|s1@x.com|yes")).body).toEqual({ role: null });
});

it("only the verified owner changes roles, and never the owner's own", async () => {
  expect((await call("s1|s1@x.com|yes", { method: "PUT", body: JSON.stringify({ uid: "s2", admin: true }) })).status).toBe(403);
  expect((await call("o1|gtsuniu@gmail.com|no", { method: "PUT", body: JSON.stringify({ uid: "s2", admin: true }) })).status).toBe(403);
  expect((await call(OWNER, { method: "PUT", body: JSON.stringify({ uid: "o1", admin: false }) })).status).toBe(400);
  expect((await call(OWNER, { method: "PUT", body: JSON.stringify({ uid: "s/2", admin: true }) })).status).toBe(400);
  expect((await call(OWNER, { method: "PUT", body: JSON.stringify({ uid: "s2" }) })).status).toBe(400);
});

it("a later sign-in keeps the first-seen time and updates the rest", async () => {
  await call("s1|s1@x.com|yes", { method: "POST" });
  const first = (blobs.get("members/roster") as { people: Record<string, { createdAt: number; lastSeenAt: number }> }).people.s1;
  await new Promise((r) => setTimeout(r, 5));
  await call("s1|new@x.com|yes", { method: "POST" });
  const again = (blobs.get("members/roster") as { people: Record<string, { createdAt: number; lastSeenAt: number; email: string }> }).people.s1;
  expect(again.createdAt).toBe(first.createdAt);
  expect(again.lastSeenAt).toBeGreaterThan(first.lastSeenAt);
  expect(again.email).toBe("new@x.com");
});
