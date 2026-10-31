import { beforeEach, expect, it, vi } from "vitest";

const blobs = new Map<string, unknown>();
vi.mock("../../netlify/lib/store", () => ({
  hosted: () => false,
  openNamedStore: (name: string) => ({
    get: async (k: string) => blobs.get(`${name}/${k}`) ?? null,
    setJSON: async (k: string, v: unknown) => { blobs.set(`${name}/${k}`, v); },
    delete: async (k: string) => { blobs.delete(`${name}/${k}`); },
    list: async () => [],
    update: async () => null,
  }),
}));
process.env.VITE_FIREBASE_API_KEY = "key";
process.env.VITE_FIREBASE_PROJECT_ID = "project";
process.env.VITE_ADMIN_EMAILS = "owner@x.com";
// Google's sign-in lookup, as the handler asks for it; the People-list role is read from the site's own store.
vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ users: [{ localId: "u1", email: "me@x.com", emailVerified: true, displayName: "Me" }] }))));
const giveRole = (role: string) => blobs.set("members/roles", { admins: role === "admin" ? { u1: { by: "o", at: 1 } } : {} });
const { default: links, hashToken, MAX_LINKS } = await import("../../netlify/functions/mcp-token");

const ask = async (method: string) => (await links(new Request("https://site.test/api/mcp-token", { method, headers: { authorization: "Bearer id-token" } }))).json();
const live = (url: string) => blobs.get(`mcp-tokens/tokens/${hashToken(url.split("/").pop()!)}`) as { role: string } | undefined;

beforeEach(() => { blobs.clear(); giveRole("student"); });

it("keeps every link an account makes working, up to the limit, and removes them all together", async () => {
  const claude = (await ask("POST")).url;
  const chatgpt = await ask("POST");
  expect(chatgpt).toMatchObject({ connected: true, links: 2 });
  expect([live(claude), live(chatgpt.url)].every(Boolean)).toBe(true);
  // Past the limit, the oldest goes.
  const more = [];
  for (let i = 0; i < MAX_LINKS - 1; i++) more.push((await ask("POST")).url);
  expect(live(claude)).toBeUndefined();
  expect(live(chatgpt.url)).toBeTruthy();
  expect((await ask("GET")).links).toBe(MAX_LINKS);
  expect(await ask("DELETE")).toMatchObject({ connected: false, links: 0 });
  expect([chatgpt.url, ...more].some((u) => live(u))).toBe(false);
});

it("carries over an account's single link from before, and brings every link up to the account's current role", async () => {
  blobs.set("mcp-tokens/users/u1", { hash: hashToken("oldtoken"), createdAt: 5 });
  blobs.set(`mcp-tokens/tokens/${hashToken("oldtoken")}`, { uid: "u1", role: "student" });
  expect(await ask("GET")).toMatchObject({ connected: true, links: 1, createdAt: 5 });
  giveRole("admin");
  const made = await ask("POST");
  expect(made.links).toBe(2);
  expect(live("https://site.test/api/mcp/oldtoken")?.role).toBe("admin");
  expect(live(made.url)?.role).toBe("admin");
});
