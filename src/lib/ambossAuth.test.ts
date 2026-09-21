import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db, getSettings, patchSettings } from "../data/db";
import { ambossCheck, ambossLogin, ambossLogout, ambossPhraseGroup, ambossPhrases, restoreAmbossSession } from "./amboss";
import { decryptAmbossPassword, encryptAmbossLogin, forgetAmbossLogin, getRememberedAmbossLogin } from "./ambossCredentials";
import { exportAll } from "./exportImport";
import { settingsForCloud } from "./sync";

const credentials = { username: "sample@example.test", password: "test-password-only" };
const success = () => Response.json({ data: { login: { token: "new-token", user: { eid: "sample-user" } } } });
const noAccess = "permission.user_is_not_authorized";
beforeEach(async () => {
  await ambossLogout(); await db.settings.clear();
});
afterEach(() => { vi.unstubAllGlobals(); });
async function savedLogin() {
  const row = await encryptAmbossLogin(credentials.username, credentials.password);
  await db.deviceLogins.put({ ...row, userId: "sample-user" });
  await patchSettings({ ambossToken: "expired-token", ambossUser: { eid: "sample-user" } });
}
function server(respond: (body: Record<string, any>, token?: string) => Response | Promise<Response>) {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => respond(JSON.parse(String(init?.body)), (init?.headers as Record<string, string>)["x-amboss-token"]));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("remembered AMBOSS login", () => {
  it("shares simultaneous preview and panel lookups and caches the result", async () => {
    await patchSettings({ ambossToken: "test-token" });
    const fetcher = server(() => Response.json({ data: { phraseGroup: { eid: "shared-preview", title: "Reference", abstract: "An explanation." } } }));
    const [preview, panel] = await Promise.all([ambossPhraseGroup("shared-preview"), ambossPhraseGroup("shared-preview")]);
    expect(preview).toEqual(panel);
    expect(preview.abstract).toBe("An explanation.");
    expect(await ambossPhraseGroup("shared-preview")).toEqual(preview);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("allows retrying a preview after a failed lookup", async () => {
    await patchSettings({ ambossToken: "test-token" });
    const fetcher = server(() => new Response(null, { status: 503 }));
    await expect(ambossPhraseGroup("retry-preview")).rejects.toThrow();
    fetcher.mockResolvedValue(Response.json({ data: { phraseGroup: { eid: "retry-preview", title: "Reference" } } }));
    expect((await ambossPhraseGroup("retry-preview")).title).toBe("Reference");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("stores encrypted credentials and excludes them and tokens from sync/backups", async () => {
    server((body) => body.action === "login" ? success() : Response.json({ target: "platform_article" }));
    await ambossLogin(credentials.username, credentials.password, true);
    const saved = (await db.deviceLogins.get("amboss"))!;
    expect(saved.key.extractable).toBe(false);
    expect(new TextDecoder().decode(saved.ciphertext)).not.toContain(credentials.password);
    expect(await decryptAmbossPassword(saved)).toBe(credentials.password);
    expect(await getRememberedAmbossLogin()).toEqual({ username: credentials.username, revision: saved.revision, needsAttention: false });
    const cloud = settingsForCloud(await getSettings());
    expect(cloud.ambossToken).toBeUndefined();
    expect(cloud.ambossUser).toBeUndefined();
    expect(JSON.stringify(await exportAll())).not.toContain(credentials.password);
    expect(JSON.stringify(await exportAll())).not.toContain(credentials.username);
  });
  it("coalesces simultaneous expired requests into one login, then retries both lookups", async () => {
    await savedLogin();
    let loginCount = 0;
    server(async (body, token) => {
      if (body.action === "login") { loginCount++; return success(); }
      if (token === "expired-token") return new Response(null, { status: 401 });
      return Response.json({ results: [{ term: "pain", pg_id: "term-id" }] });
    });
    const [a, b] = await Promise.all([ambossPhrases("one", ["pain"]), ambossPhrases("two", ["pain"])]);
    expect(a[0].pgId).toBe("term-id"); expect(b).toEqual(a);
    expect(loginCount).toBe(1);
    expect((await getSettings()).ambossToken).toBe("new-token");
  });
  it("handles GraphQL session rejection but does not relogin for restricted article fields", async () => {
    await savedLogin();
    let loginCount = 0;
    server((body, token) => {
      if (body.action === "login") { loginCount++; return success(); }
      if (body.action === "check") return token === "expired-token" ? Response.json({ data: { currentUser: null }, errors: [{ message: noAccess }] }) : Response.json({ data: { currentUser: { eid: "sample-user" } } });
      return Response.json({ data: { phraseGroup: { eid: "restricted", title: "Restricted reference", abstract: null } }, errors: [{ message: noAccess, path: ["phraseGroup", "abstract"] }] });
    });
    expect(await ambossCheck()).toBe(true);
    expect((await ambossPhraseGroup("restricted")).paywalled).toBe(true);
    expect(loginCount).toBe(1);
  });
  it("stops retrying saved credentials that are rejected", async () => {
    await savedLogin(); let loginCount = 0;
    server((body) => {
      if (body.action === "login") { loginCount++; return Response.json({ data: { login: null }, errors: [{ message: "access_denied.credentials_are_wrong" }] }); }
      return new Response(null, { status: 401 });
    });
    await expect(ambossPhrases("bad-one", ["pain"])).rejects.toThrow("sign in");
    await expect(ambossPhrases("bad-two", ["pain"])).rejects.toThrow("needs attention");
    expect(loginCount).toBe(1);
    expect((await getRememberedAmbossLogin())?.needsAttention).toBe(true);
  });
  it("preserves the saved password on temporary failure and avoids repeated immediate logins", async () => {
    await savedLogin(); let loginCount = 0;
    server((body) => {
      if (body.action === "login") { loginCount++; throw new Error("Offline"); }
      return new Response(null, { status: 401 });
    });
    await expect(ambossPhrases("offline-one", ["pain"])).rejects.toThrow("Offline");
    await expect(ambossPhrases("offline-two", ["pain"])).rejects.toThrow("paused");
    expect(loginCount).toBe(1);
    expect((await getRememberedAmbossLogin())?.needsAttention).toBe(false);
  });
  it("restores a missing session but does not contact AMBOSS when the session is already present", async () => {
    await savedLogin();
    const fetcher = server(() => success());
    await restoreAmbossSession(); expect(fetcher).not.toHaveBeenCalled();
    await patchSettings({ ambossToken: undefined });
    await restoreAmbossSession();
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await getSettings()).ambossToken).toBe("new-token");
  });
  it("does not restore the session if the user logs out while reconnection is in flight", async () => {
    await savedLogin();
    let finish!: (response: Response) => void;
    let announce!: () => void;
    const started = new Promise<void>((resolve) => { announce = resolve; });
    server((body) => {
      if (body.action === "login") { announce(); return new Promise<Response>((resolve) => { finish = resolve; }); }
      return new Response(null, { status: 401 });
    });
    const lookup = ambossPhrases("inflight", ["pain"]);
    const rejected = expect(lookup).rejects.toThrow("cancelled");
    await started; await ambossLogout(); finish(success()); await rejected;
    expect((await getSettings()).ambossToken).toBeUndefined();
    expect(await getRememberedAmbossLogin()).toBeNull();
  });
  it("lets the user forget the password without ending the current session", async () => {
    await savedLogin(); await forgetAmbossLogin();
    expect(await getRememberedAmbossLogin()).toBeNull();
    expect((await getSettings()).ambossToken).toBe("expired-token");
  });
  it("retries a rejected fresh token only once", async () => {
    await savedLogin(); let loginCount = 0;
    server((body) => { if (body.action === "login") { loginCount++; return success(); } return new Response(null, { status: 401 }); });
    await expect(ambossPhrases("still-invalid", ["pain"])).rejects.toThrow("expired");
    expect(loginCount).toBe(1);
    expect((await getSettings()).ambossToken).toBeUndefined();
    expect((await getRememberedAmbossLogin())?.needsAttention).toBe(true);
  });
});
