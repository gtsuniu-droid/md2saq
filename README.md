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
2. To enable uploads to the shared bank, add an environment variable in the Netlify site
   settings: `BANK_PASSCODE` set to whatever passcode you want to hand to trusted people.
   Without it the bank is read-only. Browsing and importing from the bank needs no
   passcode.

The bank is stored in Netlify Blobs through `netlify/functions/bank.ts`. It only works on
the deployed site, or locally under `netlify dev`. Under plain `npm run dev` the Bank
page shows "not reachable", which is expected.

## Import formats

Numbered questions (`1.`, `1)`, `Q1`, `Question 1:`), or blank-line separated blocks.
Sub-parts as `(a)`, `a.`, `1)` under a stem. Marks as `(4 marks)`, `[4]` or `4 marks`.
A model answer follows a line starting with `Answer:`, `Model answer:` or `A:`. One
marking point per line, or a semicolon-separated list. If the model answer is sectioned
with the same labels as the parts, each part gets its own marking points. The preview on
the Import page lets you fix any mis-split before saving.

## Layout

- **Coverage**: the 47 presentations with their state (grey = not started, amber =
  attempted, green = marked), question counts, mean score and last studied date.
- **Library**: filter, select, and start a practice or exam paper.
- **Paper**: sidebar of question parts on the left, stem in the middle, one answer box
  per part on the right, scrolling independently. Bold, italic, underline, highlight.
  Timer at the top. When it hits zero, everything locks and submits.
- **Mark**: confidence rating before the reveal, marking points to tick, per-part scores,
  error tags, reflection, learning point.
- **Bank**: shared question sets. Import into your library, or upload one of yours.
- **Settings**: minutes per mark, JSON backup and restore, Anki export of learning points.
