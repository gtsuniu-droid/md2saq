import { getStore } from "@netlify/blobs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface JsonStore {
  get(key: string, opts: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys starting with the prefix. */
  list(prefix: string): Promise<string[]>;
}

export function hosted(): boolean {
  return !!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_DEV);
}

/** A named blob store on Netlify; a JSON file under .netlify/ anywhere else, so features can be tried locally. */
export function openNamedStore(name: string): JsonStore {
  if (hosted()) {
    const store = getStore({ name, consistency: "strong" });
    return {
      get: (key, opts) => store.get(key, opts),
      setJSON: async (key, value) => { await store.setJSON(key, value); },
      delete: (key) => store.delete(key),
      list: async (prefix) => (await store.list({ prefix })).blobs.map((b) => b.key),
    };
  }
  const file = join(process.cwd(), ".netlify", `dev-${name}.json`);
  const load = (): Record<string, unknown> => { try { return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { return {}; } };
  const save = (data: Record<string, unknown>) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(data)); };
  return {
    async get(key) { return load()[key] ?? null; },
    async setJSON(key, value) { const d = load(); d[key] = value; save(d); },
    async delete(key) { const d = load(); delete d[key]; save(d); },
    async list(prefix) { return Object.keys(load()).filter((k) => k.startsWith(prefix)); },
  };
}
