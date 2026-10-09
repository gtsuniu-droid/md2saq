import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Run the Netlify functions under /api during `vite dev`, so the relays work locally. */
function netlifyFunctionsDev(): Plugin {
  return {
    name: "netlify-functions-dev",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? "";
        const m = /^\/api\/([a-z]+)(\?.*)?$/.exec(url);
        if (!m) return next();
        try {
          const mod = (await server.ssrLoadModule(`/netlify/functions/${m[1]}.ts`)) as { default: (r: Request) => Promise<Response> };
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
          const request = new Request(`http://${req.headers.host ?? "localhost"}${url}`, { method: req.method, headers, body: body && req.method !== "GET" ? body : undefined });
          const response = await mod.default(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), netlifyFunctionsDev()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
