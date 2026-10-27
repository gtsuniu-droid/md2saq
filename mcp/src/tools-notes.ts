import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BankClient } from "./client.js";
import { docToMarkdown, docToText, markdownToDoc, type DocNode } from "./markdownDoc.js";
import { resolvePresentation } from "./presentations.js";
import type { SharedNote } from "./types.js";
import { fail, ok, presentationName } from "./util.js";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const SECTIONS = ["overview", "ddx", "hx-exam", "ix", "mx", "extras"] as const;
const SECTION_HELP = "overview (definitions, objectives), ddx (differentials), hx-exam (history and examination), ix (investigations), mx (management), extras (cases, extra reference).";
const KINDS = ["Lecture Notes", "My Notes", "Missed Questions", "First Aid", "Sketchy", "Sketchy 2", "Sketchy Extra", "Bootcamp", "Pathoma", "Boards and Beyond", "OneNote"];

const presentationRef = z.string().describe("Presentation id, name or synonym, e.g. \"dizziness\".");
const noteRef = z.string().describe("The note's id, or its exact title.");

function describe(n: SharedNote, withBody: boolean) {
  const body = withBody ? docToMarkdown(n.doc as DocNode) : undefined;
  return { id: n.id, title: n.title, section: n.section ?? "overview", kind: n.kind, presentation: presentationName(n.presentationId), presentationId: n.presentationId, updatedAt: new Date(n._m || n.createdAt).toISOString(), words: n.text.trim().split(/\s+/).filter(Boolean).length, ...(withBody ? { markdown: body } : {}) };
}

async function findNote(bank: BankClient, presentation: string, ref: string): Promise<{ id: string; notes: SharedNote[]; note: SharedNote }> {
  const id = resolvePresentation(presentation)?.id;
  if (!id) throw new Error(`Unknown presentation "${presentation}". listPresentations gives the ids.`);
  const notes = (await bank.listNotes(id)).filter((n) => !n.deleted);
  const note = notes.find((n) => n.id === ref) ?? notes.find((n) => n.title.trim().toLowerCase() === ref.trim().toLowerCase());
  if (!note) throw new Error(`No note "${ref}" under ${presentationName(id)}. listNotes shows the titles and ids.`);
  return { id, notes, note };
}

/** The shared notes behind the Notes page: read for everyone, written by admins, in Markdown. */
export function registerNoteTools(server: McpServer, bank: BankClient, readOnly: boolean): void {
  if (readOnly) {
    server.registerTool("listNotes", {
      title: "List notes",
      description: "The shared notes under one presentation (the Notes page every student sees): id, title, section, kind and size. getNote reads one as Markdown.",
      inputSchema: { presentation: presentationRef },
      annotations: READ,
    }, async ({ presentation }) => {
      try {
        const id = resolvePresentation(presentation)?.id;
        if (!id) return fail(new Error(`Unknown presentation "${presentation}".`), { hint: "listPresentations gives the ids and names." });
        const notes = (await bank.listNotes(id)).filter((n) => !n.deleted).sort((a, b) => (a.section ?? "overview").localeCompare(b.section ?? "overview") || a.title.localeCompare(b.title));
        return ok({ success: true, presentation: presentationName(id), count: notes.length, sections: SECTION_HELP, notes: notes.map((n) => describe(n, false)) });
      } catch (e) { return fail(e, { presentation }); }
    });

    server.registerTool("getNote", {
      title: "Get a note",
      description: "One shared note as Markdown: headings, lists, bold and tables come through as such. Pictures show as [picture].",
      inputSchema: { presentation: presentationRef, note: noteRef },
      annotations: READ,
    }, async ({ presentation, note: ref }) => {
      try { const { note } = await findNote(bank, presentation, ref); return ok({ success: true, note: describe(note, true) }); }
      catch (e) { return fail(e, { presentation, note: ref }); }
    });
    return;
  }

  server.registerTool("addNote", {
    title: "Add a shared note",
    description: "Publish a new note under a presentation on the shared Notes page. Write the body in Markdown: # headings, bullet or numbered lists, **bold**, and pipe tables (| Feature | A | B |) all become real formatting. Pick the section it belongs in.",
    inputSchema: {
      presentation: presentationRef,
      title: z.string().min(1).max(200),
      markdown: z.string().min(1).describe("The note body in Markdown."),
      section: z.enum(SECTIONS).default("overview").describe(SECTION_HELP),
      kind: z.string().max(80).default("Lecture Notes").describe(`Which collection it belongs to; usually one of ${KINDS.join(", ")}.`),
    },
    annotations: WRITE,
  }, async ({ presentation, title, markdown, section, kind }) => {
    try {
      const id = resolvePresentation(presentation)?.id;
      if (!id) return fail(new Error(`Unknown presentation "${presentation}".`), { hint: "listPresentations gives the ids and names." });
      const doc = markdownToDoc(markdown);
      const note: SharedNote = { id: `shared-${randomUUID()}`, presentationId: id, kind: kind.trim() || "Lecture Notes", section, title: title.trim(), doc, text: docToText(doc), source: "", ownerId: "@shared", createdAt: Date.now(), _m: 0, revision: "", deleted: false };
      const saved = await bank.saveNote(note);
      return ok({ success: true, note: describe(saved, false), message: `Published under ${presentationName(id)}, ${section}. Students see it on the Notes page.` });
    } catch (e) { return fail(e, { presentation, title }); }
  });

  server.registerTool("updateNote", {
    title: "Update a shared note",
    description: "Change a shared note's title, section, kind or body. The body is replaced by the Markdown given, or extended when append is true. Read it with getNote first and change only what was asked.",
    inputSchema: {
      presentation: presentationRef, note: noteRef,
      title: z.string().min(1).max(200).optional(),
      section: z.enum(SECTIONS).optional(),
      kind: z.string().max(80).optional(),
      markdown: z.string().optional().describe("New body in Markdown, or text to add at the end when append is true."),
      append: z.boolean().default(false),
    },
    annotations: WRITE,
  }, async ({ presentation, note: ref, title, section, kind, markdown, append }) => {
    try {
      if (title === undefined && section === undefined && kind === undefined && markdown === undefined) return fail(new Error("Nothing to change."), { note: ref });
      const { note } = await findNote(bank, presentation, ref);
      let doc = note.doc as DocNode;
      if (markdown !== undefined) doc = append ? markdownToDoc(`${docToMarkdown(doc)}\n\n${markdown}`) : markdownToDoc(markdown);
      const next: SharedNote = { ...note, title: title?.trim() || note.title, section: section ?? note.section, kind: kind?.trim() || note.kind, doc, text: docToText(doc) };
      const saved = await bank.saveNote(next, note.revision || undefined);
      return ok({ success: true, note: describe(saved, false), changed: [title !== undefined && "title", section !== undefined && "section", kind !== undefined && "kind", markdown !== undefined && (append ? "appended" : "body")].filter(Boolean), message: "Saved and published." });
    } catch (e) { return fail(e, { presentation, note: ref }); }
  });

  server.registerTool("deleteNote", {
    title: "Delete a shared note",
    description: "Remove a shared note from the Notes page for everyone. Runs only with confirmDeletion true.",
    inputSchema: { presentation: presentationRef, note: noteRef, confirmDeletion: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ presentation, note: ref, confirmDeletion }) => {
    try {
      if (!confirmDeletion) return fail(new Error("Not confirmed."), { note: ref, hint: "Ask the user, then call again with confirmDeletion true." });
      const { note } = await findNote(bank, presentation, ref);
      await bank.saveNote({ ...note, deleted: true }, note.revision || undefined);
      return ok({ success: true, deleted: note.title, message: "Removed from the Notes page." });
    } catch (e) { return fail(e, { presentation, note: ref }); }
  });
}
