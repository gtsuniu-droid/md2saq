import { describe, expect, it, vi, afterEach } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe("admin access", () => {
  it("defaults to the owner rather than granting access to everyone", async () => {
    vi.stubEnv("VITE_ADMIN_EMAILS", ""); vi.resetModules();
    const { isAdmin } = await import("./admin");
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin({})).toBe(false);
    expect(isAdmin({ cloudUser: { uid: "reader", email: "reader@example.com" } })).toBe(false);
    expect(isAdmin({ cloudUser: { uid: "owner", email: "GTSUNIU@gmail.com" } })).toBe(true);
  });
  it("honours a configured admin list", async () => {
    vi.stubEnv("VITE_ADMIN_EMAILS", "admin@example.com"); vi.resetModules();
    const { isAdmin } = await import("./admin");
    expect(isAdmin({ cloudUser: { uid: "reader", email: "reader@example.com" } })).toBe(false);
    expect(isAdmin({ cloudUser: { uid: "admin", email: "admin@example.com" } })).toBe(true);
  });
});
