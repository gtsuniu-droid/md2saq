import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

interface BankEntry {
  id: string;
  name: string;
  source?: string;
  questionCount: number;
  presentations: string[];
  uploadedAt: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req: Request): Promise<Response> => {
  const store = getStore("bank");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    if (id) {
      const pack = await store.get(`sets/${id}`, { type: "json" });
      return pack ? json(pack) : new Response("Not found", { status: 404 });
    }
    const index = ((await store.get("index", { type: "json" })) as BankEntry[] | null) ?? [];
    return json({ sets: index.sort((a, b) => b.uploadedAt - a.uploadedAt) });
  }

  if (req.method === "POST") {
    const expected = process.env.BANK_PASSCODE;
    if (!expected) return new Response("Bank uploads are not configured on this site.", { status: 503 });
    if (req.headers.get("x-passcode") !== expected) return new Response("Wrong passcode.", { status: 403 });

    const pack = (await req.json()) as {
      format?: string;
      set?: { id?: string; name?: string; source?: string };
      questions?: { presentations?: string[] }[];
    };
    if (pack.format !== "saq-practice-set" || !pack.set || !Array.isArray(pack.questions)) {
      return new Response("Not a question set.", { status: 400 });
    }
    if (JSON.stringify(pack).length > 2_000_000) return new Response("Set too large.", { status: 413 });

    const id = crypto.randomUUID();
    const presentations = [...new Set(pack.questions.flatMap((q) => q.presentations ?? []))];
    const entry: BankEntry = {
      id,
      name: String(pack.set.name ?? "Untitled set").slice(0, 200),
      source: pack.set.source ? String(pack.set.source).slice(0, 200) : undefined,
      questionCount: pack.questions.length,
      presentations,
      uploadedAt: Date.now(),
    };
    await store.setJSON(`sets/${id}`, pack);
    const index = ((await store.get("index", { type: "json" })) as BankEntry[] | null) ?? [];
    await store.setJSON("index", [...index, entry]);
    return json(entry, 201);
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/bank" };
