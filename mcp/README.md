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

## Tools

| Tool | What it does |
| --- | --- |
| `listSets` | Every set, newest change first, with its bank id. Filter by presentation or words. |
| `listPresentations` | The presentation ids and how many sets each has. |
| `getSet` | One set in full: details, every question with number, id, stems, parts, marks and model answers. |
| `findQuestions` | Search all stems, questions and model answers for words or a phrase. |
| `updateQuestion` | Change a question's text, marks or model answer. |
| `updatePart` | Change one part, (a), (b)…: text, marks or model answer. |
| `updateStem` | Rewrite a case stem; every question showing it is updated together. |
| `updateSet` | Title, collection, tags, presentation, instructions, marking notes, debrief, minutes. |
| `addQuestion` | Append a question, with parts if wanted. |
| `removeQuestion` | Remove a question. Needs `confirmDeletion: true`. |
| `addSet` | Create a set from a pasted paper (the Create page's text format). |
| `deleteSet` | Delete a set for everyone. Needs `confirmDeletion: true`. |

With `--read-only` (or `SAQ_READ_ONLY=1`) only the first four are offered.

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
| `SAQ_SITE_URL` | The site. Defaults to `https://md2saq.netlify.app`. Use `http://localhost:5173` against `npm run dev`. |
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
        "SAQ_SITE_URL": "https://md2saq.netlify.app",
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
