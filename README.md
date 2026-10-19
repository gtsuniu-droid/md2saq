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
   passcode you hand to people who may edit the bank. Everyone can read the bank and
   gets its sets in their library automatically; only Master needs the passcode.

The bank is stored in Netlify Blobs through `netlify/functions/bank.ts`. It only works on
the deployed site, or locally under `netlify dev`. Under plain `npm run dev` the Bank
page shows "not reachable", which is expected.

## Google sign-in and cloud sync

Optional. With it, a person's attempts, marks, stem highlights and settings follow them
between devices; without it, everything stays on the device as before. Questions and
sets are not part of this; they still come from the shared bank.

Setup, once, about ten minutes:

1. Create a project at https://console.firebase.google.com. Add a Web app to it and copy
   the four values `apiKey`, `authDomain`, `projectId`, `appId`.
2. Authentication, Sign-in method: enable Google. Under Settings, Authorized domains,
   add your Netlify domain (for example `md2saq.netlify.app`).
3. Firestore Database: create it (production mode), then paste the contents of
   `firestore.rules` from this repo into Rules and publish. The rules let each signed-in
   person read and write only their own documents.
4. In Netlify, Site configuration, Environment variables, add `VITE_FIREBASE_API_KEY`,
   `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`,
   then trigger a deploy. These values are safe to be public; the rules do the protecting.
   For local development put the same four in a `.env.local` file (see `.env.example`).

Then Settings shows "Sign in with Google". Sync runs after sign-in, whenever the tab
comes back into view, every two minutes, and a few seconds after anything is typed into
a paper or a mark is saved; "Sync now" forces it. Records modified since the last sync
go up, newer records come down, newest wins. A record from another device finds its
question by bank set and position, so both devices must have imported the set from the
bank.

The paper in progress follows the account too: its answers are saved as they are typed,
and the paper itself (which questions, where you were, the exam clock) goes up with them.
Sign in on another device and Home offers to continue it there.

## AMBOSS

Settings has an AMBOSS login. It does what the official AMBOSS Anki add-on does, using
the same four calls: the add-on's login mutation for a token, the phrase finder to list
the terms in a question, the phrase-group query for a term's definition, and the access
check to decide whether links go to the full article or the public one. The calls go
through `netlify/functions/amboss.ts` because AMBOSS's endpoints do not allow browser
pages to call them directly. The relay stores nothing; the token lives in your browser.

Terms are underlined in the same teal as the add-on on question pages and while
marking. Click one for the definition and links into AMBOSS. Highlighting is off while
sitting a paper unless you turn it on in Settings. Results are cached on the device for
a month (terms) and a week (definitions), as the add-on caches them in memory.

Under `npm run dev` the functions run inside Vite, so AMBOSS works locally, and the
published sets are kept in a local file (`.netlify/dev-bank.json`) with the admin
passcode `dev`, so publishing can be tried without deploying.

## Adding many questions quickly

Three ways, fastest first:

1. **Drop a generated case bank.** On Create, drop the output folder of the generator,
   or its files: `all_questions.txt`, `all_explained_answers.txt` and
   `contents_and_coverage.txt`, or the per-case files, or one file holding every case's
   questions and answers together. A case that appears in both the
   combined file and its own file is taken once. Every `CASE NN: TITLE`, `SET NN: TITLE` or
   `VOM-01 | Title` becomes a
   numbered set with the case title kept as detail, its stem, questions, parts and marks, the matching
   explained answers attached per question and per part, the coverage file's conditions
   as tags, and the paper's instructions, marking principles and debrief kept with it.
   Answers may be separate files keyed by question, or inline under each question or part
   as `Answer:` or `Credit:` bullets; `Marking:` and `Teaching note:` lines are kept out of
   the tick points and shown in the debrief instead.
   One click saves them all or saves and shares them all.
2. **Drop plain files.** Any other `.md` or `.txt` file becomes one set named after
   the file, parsed with the rules below.
3. **Paste.** Paste a whole paper into the box. Save keeps you on the page with the box
   cleared, so you can paste the next one straight away. Pasted text with `CASE NN:` or
   `SET NN:` headers is split into a set per case exactly as a dropped file would be.
4. **Push from a script.** See "Pushing questions from your own generator" below.

## Staged cases and stems

A question can carry any number of stems: the case information the candidate reads
before answering. Papers written as "Stage 1 … Question 1 … Stage 2 … Question 3" parse
into exactly that, with each question holding the stems that precede it. On Create you
can also add a stem to any question by hand; it applies to that question and every
later one. In a paper every question is reachable at any time; later stems simply
appear with their question. A "Suggested
time" line in the paper is remembered and offered as the timer when you sit the whole
set.

## Import formats

Numbered questions (`1.`, `1)`, `Q1`, `Question 1:`), or blank-line separated blocks.
Sub-parts as `(a)`, `a.`, `1)` under a stem. Marks as `(4 marks)`, `[4]` or `4 marks`.
A model answer follows a line starting with `Answer:`, `Model answer:` or `A:`. One
marking point per line, or a semicolon-separated list. If the model answer is sectioned
with the same labels as the parts, each part gets its own marking points. The preview on
the Create page lets you fix any mis-split before saving.

## Numbers and tags

Sets are known by number within their presentation: Dizziness – Set 01, Set 02, and
Abdominal pain starts again at Set 01, the way an Anki tag such as
`Abdominal_pain::Set_01` would read. The server assigns the number when a set is first
published, so every device agrees; a set that has not been published yet carries a
provisional number. Numbering is automatic: the sets of a presentation are always 01 to n,
and deleting one or moving one to another presentation closes the gap.
What a set is about is carried by its tags, normally the
conditions it covers, and by its presentations. Browse filters by tag, presentation and
collection, and a set page links each tag. Title and collection are kept as detail for
searching and can be edited on the set's Edit page, along with every question, part and
model answer.

## Admin

Every change an admin makes anywhere, on a set page, a question page, while sitting a paper or in Admin, publishes straight
away when the passcode is on the device: edits, tags, moves and deletes. Deleting a published set removes it from the library
for everyone, so it does not come back on the next sync. Admin, its own page behind the passcode, is the one place the shared library is built: drop a folder or paste
a paper to add sets, Edit any set, Delete a set everywhere. Whatever is saved there is
published straight away when the site can reach it, and everyone's
library follows on their next open, matched by question position so attempts and marks
stay attached. If the server was unreachable, "Publish local changes" catches up later.

The editor reorders questions by dragging their handle and attaches pictures to a stem
or a question; pictures are resized on the way in and travel with the set.

## Admin passcode and admin account

Set `VITE_ADMIN_EMAILS` (in Netlify and `.env.local`) to the Google account emails that
may see the Admin section, comma separated. Anyone else never sees Admin, the passcode
field, Edit buttons or "+ New set". Leave it empty and Admin shows for everyone. Either
way the server still demands the passcode for every change; the email list only decides
who is shown the door.

Admin is locked behind the passcode. Anyone can practise, browse, and receive every
published set; only people with the passcode can change what is published. The
passcode is remembered per device and can be cleared from Settings.

## Layout

- **Home**: an activity heatmap with answered, score, daily average and time per
  question for the week, year or overall; and a session builder that picks
  presentations, shows progress per presentation, and starts a practice or exam of
  as many random questions as you like, cases kept together.
- **Browse**: an Anki-style tree. Every set sits under its presentation; tags with `::`
  such as `Dizziness::Vestibular::Set_01` nest it deeper or in several places at once,
  underscores showing as spaces. Any branch can be sat as one practice or exam paper.
  Open a set to see each question's last score and past sittings.
- **Paper**: sidebar of question parts on the left, stem in the middle, and on the right
  every question that shares that stem on one scrolling page, one answer box per part,
  with a draggable divider between the two panels. Select text in the stem and press
  Highlight, or ⌘⇧H, to mark it; the highlights persist through the sitting and show
  while marking. Bold, italic, underline, highlight. Timer at the top. When it hits zero,
  everything locks and submits. Leaving the paper (Home, Browse, marking a question,
  closing the tab) keeps it: the exam clock stops, and "Continue progress" in the nav or
  the card at the top of Home takes you back to where you were, or discards it. Admins
  see an Edit button on the stem and on each question.
- **Mark**: confidence rating before the reveal, marking points to tick, per-part scores,
  error tags, reflection, learning point.
- **Settings**: practice timing, account and sync, AMBOSS login, library updates, JSON
  backup and restore, Anki export, and a Danger zone. Admins also see a card linking to Admin.
- **Admin** (`/admin`, admins only, behind the passcode): the one place the shared library is
  built: add, edit, move and delete sets for everyone.
- **Landing page** (`/`): a public front page describing the app; "Begin your practice" opens
  Home at `/home`. Visitors who are signed in or have used the app before are sent straight
  to `/home`; `/welcome` always shows the landing page. Logos for the "Made for medical students at" row live in `public/landing/`.

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

## Presentation notes

Notes in the main navigation opens a shared reference library for every core presentation.
The Shared library tab is public and stored in Netlify Blobs (`presentation-notes`). Admin
access uses the existing bank passcode. Each saved edit publishes immediately, without a
website deployment. Concurrent changes are protected with conditional writes. Deleted
notes remain restorable. Only the current presentation is fetched, and a cached copy stays
available offline. Inline shared images are saved separately in `presentation-note-images`
and replaced with permanent URLs. Shared uploads can be up to 5.5 MB; private account
notes keep the 750 KB limit. My private notes is a separate personal library using account sync.
Add any number of notes with a title and a note type: Lecture Notes, First Aid, Sketchy,
Bootcamp, My Notes, or your own label. Each card opens and closes independently. The editor
accepts formatted text, nested lists and tables; pictures can be pasted or attached. Save
writes to this browser immediately. Unfinished drafts are kept on this device. Deleted
notes remain in Deleted notes and can be restored.

Signing in syncs saved notes to `users/{uid}/notes` in Firestore using the existing private
user rules. Notes created before sign-in join the first account that syncs them. Notes
already owned by another account stay separate. Reconciliation checks the remote document
in a transaction before writing, uses modification time plus revision to resolve ties,
and keeps deletion records so old devices cannot restore deleted notes accidentally.
Whole-note conflicts use the newest version; an editor with a stale revision asks you to
retain your edits before reopening. Notes over 750 KB must be split or their pictures made
smaller to stay below Firestore's document limit. Local drafts are not cloud synced.

On question, set, paper and marking screens, **Reference notes** opens a panel beside your
work. It follows the question's presentation unless you choose another. **Open in separate
window** lets you move the library to a second monitor without leaving your answer; an
Open tab link is available if popups are blocked. Same-browser windows see saved changes
through the shared local database; other devices receive them through cloud sync.

Settings → Export everything includes notes for the current account and device-only notes.
Older backups without notes still import. Importing notes assigns them to the current
account (or the device while signed out). Notes are not included in public question-set
exports or the shared question bank.

## Individual questions or whole sets

Home's New session builder offers **Individual questions** and **Whole sets**. Individual
mode picks the requested number of questions. Whole-set mode selects complete cases and
keeps their question order, including questions tagged with a different presentation.
Choose random sets by count or tick specific sets. Unattempted sets means no question in
the set has a submitted attempt. The preview is the exact selection that starts; Shuffle
selection makes a new random choice. Suggested time uses a whole set's stated time when
available, otherwise marks and your minutes-per-mark setting. Starting a new session while
one is unfinished asks before replacing it.

## Continue a session

Home and the navigation offer **Continue session** while a paper is unfinished. Home
shows the saved question number, answer part, and question preview. Changing question or
focusing an answer saves the position immediately. **Save & exit** pauses the timer;
continuing restores that question and part. Draft answers autosave to IndexedDB, with a
synchronous recovery copy to cover closing or refreshing before the delayed save finishes.
Starting another paper from Home or a set asks before replacing the existing session.

### Question suggestions and discussion

Published questions have Suggestions and Discussion controls in practice, question details, and marking. Suggestions can propose an answer or report a problem. Discussion supports comments and quoted replies. Posts are shared with signed-in users; they do not include private practice answers or saved notes automatically.

Conversations use Firestore at `questionCommunity/{bankId}/questions/{publishedQuestionId}/{suggestions|discussion}/{postId}`. They load on opening, Refresh, or Load older posts (25 at a time), without a polling loop. Question identity follows the bank ID rather than its current position. Posts use server timestamps and retry-safe document IDs. Authors may delete their own posts; the verified `gtsuniu@gmail.com` account can moderate and resolve suggestions. Post content and authorship cannot be edited after posting.

**Firebase status:** these rules were deployed and verified on project `saqmd2` on 23 September 2026. For future rules changes, deploy `firestore.rules` to the same Firebase project before enabling the corresponding UI on the live website. Publishing the Netlify build alone does not update Firebase rules. The rules retain the existing private per-user restrictions and add the shared conversation paths. If the moderator account changes, update the verified-email rule as well as the UI admin configuration. The implementation follows Firebase's [field-access rules](https://firebase.google.com/docs/firestore/security/rules-fields) and [cursor pagination](https://firebase.google.com/docs/firestore/query-data/query-cursors) guidance.

Short set links use `/s/{eight-character-code}`. Codes are derived from the permanent bank ID, survive renaming/reordering, and resolve read-only through `/api/bank?short=...`; no link database or additional publish is needed when copying. Old `/shared/...` links still open. The sharing menu now copies only whole-set links.
