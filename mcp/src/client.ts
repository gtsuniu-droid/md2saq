import { createHash } from "node:crypto";
import type { BankEntry, SetPack, SharedNote } from "./types.js";
import type { Config } from "./config.js";
import { setLabel } from "./util.js";
import { presentationMatches } from "./presentations.js";

/** The 8-character code on a set's share link, derived only from its bank id. */
export function setCode(bankId: string): string {
  return createHash("sha256").update(bankId).digest().subarray(0, 6).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

const simplify = (s: string) => s.toLowerCase().replace(/[—–-]/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

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
/** Direct access to the bank's storage, for the hosted server; the local server reads over HTTP. */
export interface BankReader {
  index(): Promise<BankEntry[]>;
  pack(bankId: string): Promise<SetPack | null>;
}

// Shared across instances so a warm serverless function does not re-download the bank.
const PACKS = new Map<string, { revision: number; pack: SetPack }>();
let INDEX: { at: number; entries: BankEntry[] } | null = null;

export interface HistoryRow { at: number; reason: "update" | "delete" | "restore"; name: string; questionCount: number }
export interface DeletedRow { id: string; name: string; group?: string; number?: number; questionCount: number; deletedAt: number }

export class BankClient {
  constructor(private readonly config: Config, private readonly reader?: BankReader) {}

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
    if (!fresh && INDEX && Date.now() - INDEX.at < 10_000) return INDEX.entries;
    let sets: BankEntry[];
    if (this.reader) sets = [...(await this.reader.index())].sort((a, b) => (b.updatedAt ?? b.uploadedAt) - (a.updatedAt ?? a.uploadedAt));
    else {
      const res = await this.check(await fetch(this.url()), "Listing the bank");
      sets = ((await res.json()) as { sets: BankEntry[] }).sets;
    }
    INDEX = { at: Date.now(), entries: sets };
    return sets;
  }

  async entry(bankId: string): Promise<BankEntry> {
    const found = (await this.listEntries()).find((e) => e.id === bankId) ?? (await this.listEntries(true)).find((e) => e.id === bankId);
    if (!found) throw new BankError(`Set ${bankId}: not found. listSets shows what exists.`, 404);
    return found;
  }

  /**
   * Find a set by whatever the user has: its short code (share link), its bank id, or a
   * label such as "Dyspnoea set 3", "dyspnoea 3" or "Abdominal pain — Set 01".
   */
  async resolve(ref: string, fresh = false): Promise<BankEntry> {
    const wanted = ref.trim();
    const entries = await this.listEntries(fresh);
    const exact = entries.find((e) => e.id === wanted || setCode(e.id) === wanted || setCode(e.id).toLowerCase() === wanted.toLowerCase());
    if (exact) return exact;
    const text = simplify(wanted);
    const numberMatch = /(\d+)\s*$/.exec(text);
    const number = numberMatch ? Number(numberMatch[1]) : undefined;
    const words = text.replace(/\bset\b/g, "").replace(/\d+\s*$/, "").trim();
    const candidates = entries.filter((e) => {
      const where = e.group ?? e.presentations[0] ?? "";
      const byPlace = !words || presentationMatches(where, words) || e.presentations.some((id) => presentationMatches(id, words)) || simplify(e.source ?? "").includes(words) || simplify(e.name).includes(words);
      const byNumber = number === undefined || e.number === number;
      return byPlace && byNumber;
    });
    if (candidates.length === 1) return candidates[0];
    const latest = await this.listEntries(true);
    const retry = latest.find((e) => e.id === wanted || setCode(e.id) === wanted);
    if (retry) return retry;
    if (candidates.length > 1) throw new BankError(`"${wanted}" matches ${candidates.length} sets: ${candidates.slice(0, 6).map((e) => `${setLabel(e)} [${setCode(e.id)}]`).join("; ")}. Give the code or the full label.`, 409);
    throw new BankError(`No set matches "${wanted}". listSets shows every set with its code and label; try the presentation name and number, e.g. "dyspnoea 3".`, 404);
  }

  /** The set's current content. Pass fresh before a write, so a change made elsewhere seconds ago is not overwritten. */
  async getPack(ref: string, fresh = false): Promise<SetPack> {
    const entry = await this.resolve(ref, fresh);
    const bankId = entry.id;
    const revision = entry.updatedAt ?? entry.uploadedAt;
    const cached = PACKS.get(bankId);
    if (cached && cached.revision === revision) return cached.pack;
    let pack: SetPack | null;
    if (this.reader) pack = await this.reader.pack(bankId);
    else {
      const res = await this.check(await fetch(this.url({ id: bankId })), `Reading set ${bankId}`);
      pack = (await res.json()) as SetPack;
    }
    if (!pack) throw new BankError(`Set ${bankId}: its content is missing from the bank.`, 404);
    PACKS.set(bankId, { revision, pack });
    return pack;
  }

  /** Every pack, fetched a few at a time. */
  async allPacks(): Promise<{ entry: BankEntry; pack: SetPack }[]> {
    const entries = await this.listEntries();
    const out: { entry: BankEntry; pack: SetPack }[] = new Array(entries.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(12, entries.length) }, async () => {
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
    PACKS.set(bankId, { revision: entry.updatedAt ?? entry.uploadedAt, pack });
    INDEX = null;
    return entry;
  }

  async createFromText(body: { name: string; text: string; source?: string; presentations?: string[]; key?: string }): Promise<BankEntry & { duplicate?: boolean }> {
    const res = await this.check(await fetch(this.url(), { method: "POST", headers: this.writeHeaders(), body: JSON.stringify({ format: "saq-practice-text", ...body }) }), "Adding a set");
    INDEX = null;
    return (await res.json()) as BankEntry & { duplicate?: boolean };
  }

  /** Reading history needs the passcode too: it can hold content that was deleted on purpose. */
  private authHeaders(): Record<string, string> {
    if (!this.config.passcode) throw new PasscodeMissingError();
    return { "x-passcode": this.config.passcode };
  }

  /** Create a set from a complete pack (a duplicate, or one built in memory). */
  async createPack(pack: SetPack, key?: string): Promise<BankEntry> {
    const res = await this.check(await fetch(this.url(), { method: "POST", headers: this.writeHeaders(), body: JSON.stringify({ ...pack, key }) }), "Adding a set");
    INDEX = null;
    return (await res.json()) as BankEntry;
  }

  /** How a paper would split into questions, with nothing stored. */
  async preview(body: { name: string; text: string; source?: string; presentations?: string[] }): Promise<SetPack> {
    const res = await this.check(await fetch(this.url({ preview: "1" }), { method: "POST", headers: this.writeHeaders(), body: JSON.stringify({ format: "saq-practice-text", ...body }) }), "Previewing a set");
    return ((await res.json()) as { pack: SetPack }).pack;
  }

  async history(bankId: string): Promise<HistoryRow[]> {
    const res = await this.check(await fetch(this.url({ history: bankId }), { headers: this.authHeaders() }), `History of set ${bankId}`);
    return ((await res.json()) as { versions: HistoryRow[] }).versions;
  }

  async historyPack(bankId: string, at: number): Promise<{ at: number; reason: string; pack: SetPack }> {
    const res = await this.check(await fetch(this.url({ history: bankId, at: String(at) }), { headers: this.authHeaders() }), `Version ${at} of set ${bankId}`);
    return (await res.json()) as { at: number; reason: string; pack: SetPack };
  }

  async deletedSets(): Promise<DeletedRow[]> {
    const res = await this.check(await fetch(this.url({ deleted: "1" }), { headers: this.authHeaders() }), "Listing deleted sets");
    return ((await res.json()) as { deleted: DeletedRow[] }).deleted;
  }

  /** Make an earlier version current again; for a deleted set this brings it back under its old id. */
  async restore(bankId: string, at: number): Promise<BankEntry> {
    const res = await this.check(await fetch(this.url({ id: bankId, restore: String(at) }), { method: "PUT", headers: this.writeHeaders(), body: "{}" }), `Restoring set ${bankId}`);
    PACKS.delete(bankId);
    INDEX = null;
    return (await res.json()) as BankEntry;
  }

  private notesUrl(presentation: string): string {
    const u = new URL("/api/notes", this.config.siteUrl);
    u.searchParams.set("presentation", presentation);
    return u.toString();
  }

  /** The shared notes of one presentation, as the site stores them. */
  async listNotes(presentation: string): Promise<SharedNote[]> {
    const res = await this.check(await fetch(this.notesUrl(presentation), { cache: "no-store" }), `Reading notes for ${presentation}`);
    return ((await res.json()) as { notes: SharedNote[] }).notes;
  }

  /** Create or replace a shared note; baseRevision guards against overwriting a newer edit. */
  async saveNote(note: SharedNote, baseRevision?: string): Promise<SharedNote> {
    const res = await fetch(this.notesUrl(note.presentationId), { method: "PUT", headers: this.writeHeaders(), body: JSON.stringify({ note, baseRevision }) });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new BankError(body.error ?? `Saving the note failed (${res.status}).`, res.status);
    }
    return ((await res.json()) as { note: SharedNote }).note;
  }

  async deleteSet(bankId: string): Promise<void> {
    await this.check(await fetch(this.url({ id: bankId }), { method: "DELETE", headers: this.writeHeaders() }), `Deleting set ${bankId}`);
    PACKS.delete(bankId);
    INDEX = null;
  }
}
