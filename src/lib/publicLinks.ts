import type { QuestionSet } from "../data/types";
import { setLinkCode } from "./shortSetLink";
import { fetchBankSet, syncFromBank } from "./bank";
import { db } from "../data/db";
import { readCatalogue } from "./library";
import type { SetPack } from "./exportImport";

export function sharedPath(bankId: string, questionId?: string): string {
  return `/shared/${encodeURIComponent(bankId)}${questionId ? `/question/${encodeURIComponent(questionId)}` : ""}`;
}

export function publicOrigin(origin: string): string {
  const url = new URL(origin);
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ? "https://saqmd2.netlify.app" : url.origin;
}

export async function getPublicLink(set: QuestionSet): Promise<{ path: string; url: string }> {
  if (!set.bankId) throw new Error("Publish this set before sharing a link.");
  await loadSharedPack(set.bankId);
  const path = `/s/${await setLinkCode(set.bankId)}`;
  const origin = import.meta.env.VITE_PUBLIC_SITE_URL || publicOrigin(window.location.origin);
  return { path, url: new URL(path, origin).href };
}

export async function loadShortSharedSet(code: string): Promise<{ bankId: string; pack: SetPack }> {
  if (!/^[A-Za-z0-9_-]{8}$/.test(code)) throw new Error("Not found");
  const response = await fetch(`/api/bank?short=${encodeURIComponent(code)}`);
  if (!response.ok) throw new Error(response.status === 404 ? "Not found" : "Could not load shared set.");
  const result = await response.json() as { bankId: string; pack: SetPack };
  if (!result.bankId || result.pack?.format !== "saq-practice-set" || !Array.isArray(result.pack.questions)) throw new Error("Could not read shared set.");
  return result;
}

export async function loadSharedPack(bankId: string): Promise<SetPack> {
  const pack = await fetchBankSet(bankId);
  if (pack?.format !== "saq-practice-set" || pack.version !== 1 || !pack.set?.id || !Array.isArray(pack.questions)
    || pack.questions.some(q => !q.id || typeof q.text !== "string" || !Array.isArray(q.parts))) {
    throw new Error("This shared set could not be read.");
  }
  return pack;
}

/**
 * The library set a shared link points at, for opening it in Browse: by its short code
 * (/s/…) or bank id (/shared/…). Matched against the catalogue on this device, refreshed
 * once from the bank when the set is not in it yet (a first visit, or a set just published).
 * Null when the bank no longer has it.
 */
export async function browseSetFor(link: { code?: string; bankId?: string }): Promise<string | null> {
  if (link.code && !/^[A-Za-z0-9_-]{8}$/.test(link.code)) return null;
  for (const refresh of [false, true]) {
    if (refresh) await syncFromBank();
    for (const entry of (await readCatalogue())?.entries ?? []) {
      if (link.bankId ? entry.id !== link.bankId : await setLinkCode(entry.id) !== link.code) continue;
      // The same id the library gives the set: this device's copy if it has one, else the bank's.
      return (await db.sets.where("bankId").equals(entry.id).first())?.id ?? entry.set.id;
    }
  }
  return null;
}

