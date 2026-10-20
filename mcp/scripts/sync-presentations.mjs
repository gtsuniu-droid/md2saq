// Copies the site's presentation vocabulary (ids, names, synonyms, parents) into the MCP
// package so set labels and presentation lookups match the site exactly. Runs on build.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { PRESENTATIONS } = await import(join(here, "../../src/data/presentations.ts"));
const out = PRESENTATIONS.map((p) => ({ id: p.id, name: p.name, synonyms: p.synonyms, parent: p.parent ?? null }));
writeFileSync(join(here, "../src/presentations.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`synced ${out.length} presentations`);
