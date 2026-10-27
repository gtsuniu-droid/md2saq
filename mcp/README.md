# saq-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for SAQ Practice. Add it to
Claude Desktop or Claude Code and edit the shared question bank in plain language:

- "Show me Dyspnoea set 3."
- "In chest pain set 2 question 1, add 'troponin at 0 and 6 hours' to the model answer."
- "Rewrite the stem of Dizziness set 1 so the patient is 71, not 42."
- "Find every question that mentions pulmonary embolism."
- "Turn this paper into a new abdominal pain set." (paste the paper)

Every change goes through the site's bank API with the admin passcode and publishes at once,
exactly as the Admin page does. Reading needs no passcode.

## Two ways to connect

**Hosted, nothing to install (claude.ai, ChatGPT, Claude Desktop, Claude Code).** Sign in on
the site, open Settings, AI assistants, and create your connection link. Paste it as a custom
connector in claude.ai or Claude Desktop, as an MCP server in ChatGPT's connectors (developer
mode, authentication none), or run `claude mcp add --transport http saq-practice <link>`.
While practising, marking or viewing a question, admins have a "Fix with AI" menu that opens
Claude or ChatGPT with the set code and question number already in the message.
The site serves MCP at `/api/mcp/<token>`; admins get the editing tools with the site's own
passcode, everyone else the reading tools. Making a new link stops the old one.

**Local, for development.** The same tools as a STDIO server in this folder, pointed at any
site URL with the passcode in its environment. Setup is below.

## Titles and tags

Every set has a short descriptive title (what the case is, under ten words; numbering such as
"Set 03" is automatic, so titles never start with "Case 1:") and tags naming the conditions it
covers. `addSet` asks for both, `updateSet` fixes them, `auditSets` lists sets where they are
weak, and the `tidy-metadata` prompt walks through fixing a batch.

## Naming a set

Nobody needs a bank id. Every tool takes `set` as the set's **code** (the 8 characters shown
next to the title on a set's page and in Browse, also the end of its share link), a **label**
such as "Dyspnoea set 3" or "abdominal pain 1", or the id. `listSets` and `findQuestions`
return the code and label for every set they mention.

## Tools

| Tool | What it does |
| --- | --- |
| `listSets` | Every set, newest change first, with code and label. Filter by presentation, words, tag, collection or date. |
| `listPresentations` | The presentation ids and how many sets each has. |
| `getSet` | One set in full: details, every question with number, id, stems, parts, marks and model answers. |
| `findQuestions` | Search all stems, questions and model answers for words or a phrase. |
| `auditSets` | Flag sets with recall-style questions (many short parts), missing model answers or no stem. |
| `rewriteSet` | Replace every question in a set in one call (an overhaul). Needs `confirmReplace: true`. |
| `setAnswers` | Write model answers for many questions and parts in one call. |
| `updateQuestion` | Change a question's text, marks or model answer. |
| `updatePart` | Change one part, (a), (b)…: text, marks or model answer. |
| `updateStem` | Rewrite a case stem; every question showing it is updated together. |
| `updateSet` | Title, collection, tags, presentation, instructions, marking notes, debrief, minutes. |
| `addQuestion` | Append a question, with parts if wanted. |
| `removeQuestion` | Remove a question. Needs `confirmDeletion: true`. |
| `addSet` | Create a set from a pasted paper (the Create page's text format), with its title, presentation and tags. |
| `deleteSet` | Delete a set for everyone. Needs `confirmDeletion: true`. `restoreDeletedSet` can bring it back. |
| `reviewQuestions` | Every question that breaks the house style or marking rules, grouped by set, worst first. |
| `flagQuestions` / `clearFlags` / `listFlags` | Keep questions marked for review; admins see the flags on the set page. Editing a flagged question clears it. |
| `previewSet` | Parse a paper as `addSet` would, without saving: see how it splits before publishing. |
| `applyEdits` | Several changes to one set in a single save (one history version). |
| `reorderQuestions` | Put a set's questions in a new order. |
| `duplicateSet` | Copy a set under a new title, optionally without answers or in another presentation. |
| `renameTag` | Rename or merge a tag across every set. Needs `confirm: true`. |
| `setHistory` / `restoreSet` | Earlier versions of a set (the last twenty) and undo back to one. |
| `listDeletedSets` / `restoreDeletedSet` | Deleted sets (the last fifty) and bringing one back under its old code. |
| `bankStats` / `listTags` | The shape of the bank per presentation; every tag in use. |
| `listNotes` / `getNote` | The shared notes under a presentation, read as Markdown. |
| `addNote` / `updateNote` / `deleteNote` | Publish, change or remove a shared note; Markdown tables, lists and headings become real formatting. The same Markdown works in stems, questions and model answers. |

Resources: `saq://sets` (the whole list) and `saq://set/{code}` (one set as Markdown). Prompts: `review-bank`, `overhaul-set`, `draft-set`, `tidy-metadata`, `write-answers`.

With `--read-only` (or `SAQ_READ_ONLY=1`) only the reading tools are offered.

Two prompts guide the big jobs where the client shows prompts (Claude Desktop, Claude Code):
`overhaul-set` rewrites a set's questions to MD2–MD4 clinical-reasoning level, questions only,
and `write-answers` writes thorough marking guides and saves them with one `setAnswers` call.

A typical overhaul: `auditSets` to list sets with many short subquestions, `getSet` on one,
agree the new questions, `rewriteSet` once, then in a later turn `write-answers`, agree the
answers, `setAnswers` once. Question ids are reused by position, so earlier attempts stay
attached where the numbering still matches.

Replacing text that was written with pictures or formatting drops that formatting; `getSet`
flags such questions with `hasRichText` / `hasRichModelAnswer`, and the tool says so in its
result.

## Setup

Requires Node 20 or newer.

```bash
cd mcp
npm install
npm run build
```

Configuration is by environment variable:

| Variable | Meaning |
| --- | --- |
| `SAQ_SITE_URL` | The site. Defaults to `https://saqmd2.netlify.app`. Use `http://localhost:5173` against `npm run dev`. |
| `SAQ_PASSCODE` | The bank's admin passcode (`BANK_PASSCODE` in Netlify; `dev` locally). Needed for every change. |
| `SAQ_READ_ONLY` | `1` to refuse every change. |

### Claude Code

```bash
claude mcp add saq-practice -e SAQ_PASSCODE=your-passcode -- node /path/to/saq-practice/mcp/bin/saq-mcp.js --stdio
```

### Claude Desktop

Settings, Developer, Edit Config, then add to `mcpServers`:

```json
{
  "mcpServers": {
    "saq-practice": {
      "command": "node",
      "args": ["/path/to/saq-practice/mcp/bin/saq-mcp.js", "--stdio"],
      "env": {
        "SAQ_SITE_URL": "https://saqmd2.netlify.app",
        "SAQ_PASSCODE": "your-passcode"
      }
    }
  }
}
```

Restart Claude Desktop; the tools appear under the hammer icon. Publishing the package to npm
later lets this become `npx -y saq-mcp --stdio`.

## Checking it works

With the site's dev server running (`npm run dev` in the repo root):

```bash
npm run smoke
```

This drives the built server over STDIO like a real client: lists tools, reads a set, searches,
edits a question and puts it back, and checks that deletion without confirmation is refused.

## Safety

- The passcode is the only credential. Keep it in the client's config, not in chat.
- `removeQuestion` and `deleteSet` run only with `confirmDeletion: true`; the server
  instructions tell the assistant to ask first.
- Changes publish immediately. Students' attempts on a removed question are deleted from their
  devices when their library updates.
