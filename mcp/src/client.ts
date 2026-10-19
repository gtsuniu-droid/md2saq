import type { BankEntry, SetPack } from "./types.js";
import type { Config } from "./config.js";

export class BankError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "BankError";
  }
}

export class ReadOnlyModeError extends Error {
  constructor() {
    super("The server is running in read-only mode, so nothing in the bank can be changed.");
    this.name = "ReadOnlyModeError";
  }
}

export class PasscodeMissingError extends Error {
  constructor() {
    super("No admin passcode is configured, so the bank cannot be changed. Set SAQ_PASSCODE.");
    this.name = "PasscodeMissingError";
  }
}

/**
 * The site's bank API (/api/bank). Reading is open; every change carries the
 * admin passcode. Packs are cached per bank id and revision for the life of the
 * process, so repeated reads and searches do not re-download the whole bank.
 */
export class BankClient {
  private packs = new Map<string, { revision: number; pack: SetPack }>();
  private indexCache: { at: number; entries: BankEntry[] } | null = null;

  constructor(private readonly config: Config) {}

  private url(query: Record<string, string> = {}): string {
    const u = new URL("/api/bank", this.config.siteUrl);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async check(res: Response, what: string): Promise<Response> {
    if (res.ok) return res;
    const text = (await res.text().catch(() => "")).trim();
    if (res.status === 403) throw new BankError("The site rejected the admin passcode. Check SAQ_PASSCODE.", 403);
    if (res.status === 404) throw new BankError(`${what}: not found. It may have been deleted; listSets shows what exists.`, 404);
    throw new BankError(`${what} failed (${res.status})${text ? `: ${text.slice(0, 300)}` : ""}`, res.status);
  }

  private writeHeaders(): Record<string, string> {
    if (this.config.readOnly) throw new ReadOnlyModeError();
    if (!this.config.passcode) throw new PasscodeMissingError();
    return { "content-type": "application/json", "x-passcode": this.config.passcode };
  }

  /** The index, newest change first. Cached for ten seconds so a search does not hit the site twice. */
  async listEntries(fresh = false): Promise<BankEntry[]> {
    if (!fresh && this.indexCache && Date.now() - this.indexCache.at < 10_000) return this.indexCache.entries;
    const res = await this.check(await fetch(this.url()), "Listing the bank");
    const { sets } = (await res.json()) as { sets: BankEntry[] };
    this.indexCache = { at: Date.now(), entries: sets };
    return sets;
  }

  async entry(bankId: string): Promise<BankEntry> {
    const found = (await this.listEntries()).find((e) => e.id === bankId) ?? (await this.listEntries(true)).find((e) => e.id === bankId);
    if (!found) throw new BankError(`Set ${bankId}: not found. listSets shows what exists.`, 404);
    return found;
  }

  async getPack(bankId: string): Promise<SetPack> {
    const entry = await this.entry(bankId);
    const revision = entry.updatedAt ?? entry.uploadedAt;
    const cached = this.packs.get(bankId);
    if (cached && cached.revision === revision) return cached.pack;
    const res = await this.check(await fetch(this.url({ id: bankId })), `Reading set ${bankId}`);
    const pack = (await res.json()) as SetPack;
    this.packs.set(bankId, { revision, pack });
    return pack;
  }

  /** Every pack, fetched a few at a time. */
  async allPacks(): Promise<{ entry: BankEntry; pack: SetPack }[]> {
    const entries = await this.listEntries();
    const out: { entry: BankEntry; pack: SetPack }[] = new Array(entries.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
      while (next < entries.length) {
        const i = next++;
        out[i] = { entry: entries[i], pack: await this.getPack(entries[i].id) };
      }
    }));
    return out;
  }

  async verifyPasscode(): Promise<boolean> {
    if (!this.config.passcode) return false;
    const res = await fetch(this.url({ verify: "1" }), { headers: { "x-passcode": this.config.passcode } });
    return res.status === 204;
  }

  async updatePack(bankId: string, pack: SetPack): Promise<BankEntry> {
    const res = await this.check(await fetch(this.url({ id: bankId }), { method: "PUT", headers: this.writeHeaders(), body: JSON.stringify(pack) }), `Saving set ${bankId}`);
    const entry = (await res.json()) as BankEntry;
    this.packs.set(bankId, { revision: entry.updatedAt ?? entry.uploadedAt, pack });
    this.indexCache = null;
    return entry;
  }

  async createFromText(body: { name: string; text: string; source?: string; presentations?: string[]; key?: string }): Promise<BankEntry & { duplicate?: boolean }> {
    const res = await this.check(await fetch(this.url(), { method: "POST", headers: this.writeHeaders(), body: JSON.stringify({ format: "saq-practice-text", ...body }) }), "Adding a set");
    this.indexCache = null;
    return (await res.json()) as BankEntry & { duplicate?: boolean };
  }

  async deleteSet(bankId: string): Promise<void> {
    await this.check(await fetch(this.url({ id: bankId }), { method: "DELETE", headers: this.writeHeaders() }), `Deleting set ${bankId}`);
    this.packs.delete(bankId);
    this.indexCache = null;
  }
}
