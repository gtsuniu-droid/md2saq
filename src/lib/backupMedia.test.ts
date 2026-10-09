import { afterEach, expect, it, vi } from "vitest";
import { embedBankMedia } from "./backupMedia";
afterEach(() => vi.unstubAllGlobals());
it("embeds each bank image once into a portable backup", async () => {
  const url = `https://site.test/api/bank?image=${"a".repeat(64)}`;
  const fetcher = vi.fn(async () => new Response("image", { headers: { "content-type": "image/png" } }));
  vi.stubGlobal("fetch", fetcher);
  const result = await embedBankMedia({ image: url, doc: { src: url }, text: "Keep plain text", external: "https://other.test/photo.png" });
  expect(result.image).toBe("data:image/png;base64,aW1hZ2U=");
  expect(result.doc.src).toBe(result.image);
  expect(result.text).toBe("Keep plain text");
  expect(result.external).toBe("https://other.test/photo.png");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reports incomplete backups instead of silently omitting missing images", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("offline", { status: 503 })));
  await expect(embedBankMedia({ image: `https://site.test/api/bank?image=${"a".repeat(64)}` })).rejects.toThrow("Reconnect");
});
