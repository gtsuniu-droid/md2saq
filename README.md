# SAQ Practice

A minimal site for practising short answer questions against a fixed list of clinical
presentations. Paste questions in, sit them under a timer in an exam-style layout, mark
them against the model answer, and see which presentations you have covered.

Everything is stored in the browser (IndexedDB). Nothing leaves your device except sets
you deliberately share to the bank. Export a backup from Settings now and then.

## Run locally

```bash
npm install
npm run dev
```

Tests (parser, marking points, presentation suggestion):

```bash
npm test
```

## Deploy to Netlify

1. Push this folder to a Git repository and connect it in Netlify, or drag the `dist`
   folder onto Netlify after `npm run build`. `netlify.toml` already sets the build
   command, publish folder and SPA redirect.
2. Set an environment variable in the Netlify site settings: `BANK_PASSCODE`, the
   passcode you hand to trusted people. The bank is locked behind it entirely: browsing,
   importing and sharing all need it. Each device asks once and remembers it.

The bank is stored in Netlify Blobs through `netlify/functions/bank.ts`. It only works on
the deployed site, or locally under `netlify dev`. Under plain `npm run dev` the Bank
page shows "not reachable", which is expected.

## Adding many questions quickly

Three ways, fastest first:

1. **Drop files.** On Create, drop any number of `.md` or `.txt` files. Each becomes a
   set named after the file, parsed with the rules below, and one click saves them all
   or saves and shares them all. Review any file in the preview first if you want.
2. **Paste.** Paste a whole paper into the box. Save keeps you on the page with the box
   cleared, so you can paste the next one straight away.
3. **Push from a script.** See "Pushing questions from your own generator" below.

## Import formats

Numbered questions (`1.`, `1)`, `Q1`, `Question 1:`), or blank-line separated blocks.
Sub-parts as `(a)`, `a.`, `1)` under a stem. Marks as `(4 marks)`, `[4]` or `4 marks`.
A model answer follows a line starting with `Answer:`, `Model answer:` or `A:`. One
marking point per line, or a semicolon-separated list. If the model answer is sectioned
with the same labels as the parts, each part gets its own marking points. The preview on
the Create page lets you fix any mis-split before saving.

## Layout

- **Coverage**: the 47 presentations with their state (grey = not started, amber =
  attempted, green = marked), question counts, mean score and last studied date.
- **Browse**: filter, select, and start a practice or exam paper.
- **Paper**: sidebar of question parts on the left, stem in the middle, one answer box
  per part on the right, scrolling independently. Bold, italic, underline, highlight.
  Timer at the top. When it hits zero, everything locks and submits.
- **Mark**: confidence rating before the reveal, marking points to tick, per-part scores,
  error tags, reflection, learning point.
- **Bank**: every shared question set, browsable question by question behind the
  passcode. Import into your library, or share one of yours.
- **Settings**: minutes per mark, JSON backup and restore, Anki export of learning points.

## Pushing questions from your own generator

The bank accepts plain text, parsed with the same rules as the Create page, so any script
or tool that can make an HTTP request can add questions. With `BANK_PASSCODE` set on the
site:

```bash
curl -X POST https://YOUR-SITE.netlify.app/api/bank \
  -H "content-type: application/json" \
  -H "x-passcode: YOUR_PASSCODE" \
  -d '{
    "format": "saq-practice-text",
    "name": "Chest pain batch 3",
    "source": "generator",
    "key": "chest-pain-batch-3",
    "presentations": ["chest-pain"],
    "text": "1. A 54-year-old man ... (4 marks)\nAnswer:\nECG\nTroponin\n2. ..."
  }'
```

- `text` is the questions exactly as you would paste them.
- `key` is optional. Sending the same key twice returns the existing set instead of
  creating a duplicate, so a generator can retry safely.
- `presentations` is optional. Ids are the kebab-case names in
  `src/data/presentations.ts`, for example `chest-pain` or `altered-urinary-volume`.
  Presentations are also detected from the text.
- The passcode can go in `x-passcode` or as `Authorization: Bearer ...`.

Every device with "Automatically import new bank sets" on (Settings, on by default) pulls
new sets into its library the next time the app opens. Settings also has a "Check the bank
now" button.
