# Whole-set submission correction — 21 September 2026

final result: passed

Latest user instruction supersedes the per-question submission behavior described in the earlier report below. The vertical sidebar and progressive set loading remain unchanged.

- Removed every per-question submission control from the session paper, including the top toolbar.
- Submit set appears only below the last question of the current set. It saves and submits all that set's answers together, leaving other sets untouched.
- After submission, the footer offers Mark set and Next set (or Session summary for the final set), so marking can be deferred.
- Whole sets remains the default on Home. Exam paper submission is unchanged.

Browser evidence: `/Users/gabe/Documents/Codex/2026-09-21/mmy/work/set-submit-footer.png`, 1280 × 720 CSS viewport and screenshot. Visually checked the single dark-green active sidebar row, original narrow column, existing typography/colors, and footer-only Submit set beside Next set. No image assets changed; no remaining visual findings.

Verified with isolated disposable data on port 5177: both entered answers retained and locked after one Submit set; an unsubmitted question in another set remained editable; there were no per-question Submit controls; browser console had no errors. All 156 tests and production build passed. No push or deployment.

---

# Vertical sidebar correction — 21 September 2026

final result: passed

Source: `/Users/gabe/Downloads/최근 사진 보기.png` (1290 × 2796 photo).
Implementation: `/Users/gabe/Documents/Codex/2026-09-21/mmy/work/vertical-sidebar-desktop.png` (1280 × 720 CSS viewport and capture), `vertical-sidebar-mobile.png` in the same directory (390 × 844 CSS viewport and capture).

Scope: restore the original narrow vertical question list. The user's written correction takes priority over the photo's multiple green rows: exactly one current row is dark green. No source medical imagery is needed for this navigation change.

Comparison: opened the reference and desktop implementation together in one tool result. The source is an angled, cropped photograph with unknown device density; compared the relevant sidebar structure and readable numbered rows, not full-page pixel alignment. The captured test session has two sets opened, question 3 part b selected, and question 1 submitted. Mobile was separately inspected at 390 × 844; no horizontal overflow (clientWidth and scrollWidth both 390).

Findings and corrections:
- Previous circular set buttons and current-set-only question grid were replaced with the original 110px sidebar and continuous rectangular question rows. New sets append below earlier ones.
- Removed bulk Submit set; each question now has Submit/Review marking and Next, with matching active-question controls above the paper.
- Multipart questions now select exactly one row even when no part has been selected yet.
- Kept the narrow vertical list on mobile (64px) and stacked the stem/answer area beside it.

Fidelity surfaces:
- Typography: reused existing app font and 0.9rem sidebar numerals; readable question/part labels.
- Spacing: flat, full-width rows with thin separators, no circular selectors or added set headings. Existing case and answer layout retained.
- Colors: existing dark teal for the single active row, pale teal for answered rows, neutral unvisited rows.
- Imagery: reference is a layout guide only; no image assets added or replaced.
- Copy: sequential question numbers with original part labels, per-question Submit and Next, Summary available above the paper.

Behavior verified using disposable data on isolated port 5177 with cloud authentication disabled:
- Initially only first-set questions appear; Next within the set does not reveal another set.
- Next after its last question appends the next complete set; earlier rows remain clickable.
- Unsubmitted answer text survives navigation and reload; opened sets and current question persist.
- Submit affects only the selected question; next question stays editable.
- Save and next set after marking the last question appends the next set.
- Exactly one current row, including multipart selection.
- Browser console: no errors. All 156 tests and production build pass.

No remaining P0/P1/P2 findings. Intentional differences from photo: real app content, existing fonts/colors, one active green row, and responsive stem stacking. No changes pushed or deployed in this correction.

---

# Multi-set sessions and admin sorting QA — 21 September 2026

final result: passed

## Scope and visual targets

The requested change is the example's progressive left-hand set navigation, adapted to the existing SAQ case/answer split, plus sortable admin columns. This is an existing product change, not a replacement of the SAQ editor with the reference's multiple-choice page.

- Sidebar source: `/var/folders/99/8fwqbbm14219_3ws98j9wzsh0000gp/T/TemporaryItems/NSIRD_screencaptureui_F7rpiJ/Screenshot 2026-09-21 at 5.09.34 pm.png` (2346 × 1794 pixels). Normalized 2:1 to 1173 × 897 at `/Users/gabe/Documents/Codex/2026-09-21/mmy/work/set-sidebar-reference.png`.
- Admin source: `/var/folders/99/8fwqbbm14219_3ws98j9wzsh0000gp/T/TemporaryItems/NSIRD_screencaptureui_uDGKWg/Screenshot 2026-09-21 at 5.12.51 pm.png` (1878 × 766 pixels). Normalized to 1173 × 478 at `/Users/gabe/Documents/Codex/2026-09-21/mmy/work/admin-sorting-reference.png`; this source is a table-region crop, not a full viewport.
- Desktop implementation: `/Users/gabe/Documents/Codex/2026-09-21/mmy/work/set-sidebar-desktop.png` (1173 × 897 pixels; CSS viewport 1173 × 897, effective density 1).
- Admin implementation: `/Users/gabe/Documents/Codex/2026-09-21/mmy/work/admin-sorting.png` (same viewport and density).
- Mobile implementation: `/Users/gabe/Documents/Codex/2026-09-21/mmy/work/set-sidebar-mobile.png` (390 × 844 pixels and CSS viewport, effective density 1).
- Source and implementation were opened together in each comparison tool input. The sidebar comparison shows set 2 active, with sets 1 and 2 opened; the admin comparison shows the existing table with the added date and sort controls. Sample content was used to protect actual user answers. Full-frame text and controls were readable, so a separate focused crop was unnecessary.

## Findings and fidelity checks

No actionable P0/P1/P2 visual findings remain.

- Typography: existing product font and editor text sizing retained; progress, set labels, question numbers, and sort direction remain legible. The references guide hierarchy rather than replacing product typography.
- Layout: pale left rail, Summary action, circular numbered set controls, and active-set emphasis follow the example. A 190px rail deliberately preserves room for the existing two-column SAQ editor, rather than using the example's wider MCQ sidebar. Mobile navigation wraps above the case and answers; document width and scroll width are both 390px.
- Colors: existing teal, soft-teal, navy, border, and dark-mode tokens used consistently. This intentionally retains the application's palette instead of introducing the unrelated reference's bright cyan.
- Assets: no new raster artwork is required. Numbered controls are actual buttons and progress uses a native progress element; no reference artwork is substituted with drawings. Existing editor imagery is retained.
- Copy: submission counts distinguish submitted answers from saved drafts. Set numbers and question numbers are separate. After submission, both Mark this set and Continue to next set are available. Added means the original bank publish date, or local creation date for unpublished sets; unavailable bank dates remain unknown.
- Admin table: Set, Questions, Status, Added, and Updated headings are keyboard-operable buttons with aria-sort. Original row content, selection, edit/publish controls, and filtering remain available. Recently added selects descending Added order. Updates use the latest known local or bank edit time.

## Comparison and verification history

- Initial interaction inspection found duplicate mark counts and global question numbers beside within-set navigation. Both were corrected before the recorded desktop/mobile visual comparisons; the screenshots show a single mark count and consistent question numbering.
- A new-session transition exposed a stale-paper race during stress testing. The paper now remounts for a different session and waits for aligned question/attempt data. A fresh browser run repeated same-page session replacement, skipping sets, marking the final set, and returning to an earlier draft; the saved text survived and the fresh console contained no errors.
- Browser checks passed: first set only at startup; Next appends another numbered set; earlier sets remain accessible; rapid answer entry survives navigation; reload restores the active set and answers; Submit offers mark-now or continue; marking advances through a set then opens the next; Summary allows deferred marking; unfinished earlier sets survive finishing the last set; three-second exam submits all five selected questions, including unopened sets.
- Admin checks passed: Updated descending/ascending, Added newest-first shortcut, Questions ascending/descending, and Status sorting. Sample bank calls were read-only.
- Automated checks: all 153 tests pass, including set grouping/reveal progression, identical/empty stems across different sets, older sessions, exam navigation, and cloud round-trip preservation of opened-set state. Production build and whitespace checks pass.

## Implementation checklist

- [x] Progressive set navigation with saved answers and persisted opened-set state.
- [x] Choice of marking now or continuing, with later access through Summary.
- [x] Account history and practice/exam timer behavior preserved.
- [x] Admin addition dates and sortable columns, using existing bank metadata.
- [x] Desktop/mobile captures and interaction verification.
- [x] Temporary fixture removed; no publish or deployment.

## Follow-up polish

None required for this scope. The admin view is a chronological view of existing sets, not an audit archive of previously deleted bank entries.

---

# AMBOSS hover preview QA — 21 September 2026

final result: passed

## Findings

No actionable P0/P1/P2 issues remain. The floating card follows the supplied Anki reference. Body text is intentionally reduced to 16px, the heading to 22px and abbreviation to 18px following the user's latest request for slightly smaller text.

## Evidence and normalization

- Source visual truth: `/var/folders/99/8fwqbbm14219_3ws98j9wzsh0000gp/T/TemporaryItems/NSIRD_screencaptureui_hEvm1b/Screenshot 2026-09-21 at 2.09.34 pm.png`.
- Source pixels: 1412 × 922. Compared at half scale, 706 × 461; normalized reference saved at `/Users/gabe/Documents/Codex/2026-09-21/mmy/work/amboss-reference-at-1x.png`.
- Implementation screenshot: inline browser capture in this task, tool call “Compare equal-size reference and final popup captures”. The browser screenshot API returns image bytes inline, not a saved file path.
- Implementation route for matched content: `http://127.0.0.1:5173/__amboss-hover-check.html` (temporary harness, removed after checks). It used the real NoteContent and AmbossHover components and connected AMBOSS data, without editing or publishing notes.
- CSS viewport and captured implementation pixels: 706 × 461, effective capture density 1 pixel per CSS pixel. Source density normalized 2:1. Both equal-size images were presented together in one comparison input.
- State: light theme, SUDEP term hovered, live title, abbreviation, definition and article destination loaded. The comparison is scoped to the popup; the Anki question styling outside it is not part of the requested app change.
- Full-view comparison: same 520px card width, rounded white surface, pointer to the term, heading/abbreviation/definition, separated article row and logo/Feedback footer. Horizontal position follows the term's position, which differs because the surrounding question text retains this app's typography.
- Focused comparison: card occupies most of the 706 × 461 captures; title, body, links, icons and footer are all clearly readable in the combined input, so a further crop was unnecessary.
- Additional captures: Sclerodactyly picture preview and enlarged image at 1280 × 720; keyboard preview at 390 × 844; actual abdominal-pain/DDx notes with a preview positioned above Mesenteric adenitis.

## Required fidelity surfaces

- Typography: locally bundled Lato regular/bold, matching the add-on's family. Dark bold heading, blue-grey abbreviation and definition, smaller footer text. Requested size reduction is intentional, with natural wrapping and no truncation.
- Spacing/layout: 520px maximum width; 12px viewport clearance on narrow screens; 20px content side padding; 32px top padding; distinct article and footer rows. Card flips above the term when there is more space and scrolls internally for image-rich entries.
- Colors: white card, dark grey heading, muted blue-grey copy and icons, faint dividers, soft shadow and teal brand mark match the reference palette. Existing note appearance is preserved.
- Image quality/assets: supplied AMBOSS logo, original Material document/arrow/pointer icons and actual AMBOSS medical images. Picture crop preserves proportions; the enlarged view remains sharp and includes supplied attribution. No placeholder medical imagery.
- Copy/content: live SUDEP title, abbreviation, definition and article destination agree with the supplied reference. Image-bearing terms show their real API media. Source-provided attribution is retained. No medical content was authored or changed.

## Comparison history

1. Initial visual inspection confirmed the card structure and real data. Font file format labels and subtitle cascade were corrected before the formal comparison. The user's request then reduced body/title/subtitle sizes.
2. Final equal-size, combined comparison found no actionable P0/P1/P2 drift. Smaller text and surrounding question typography are intentional differences. No visual changes followed the final comparison.

## Interaction and implementation checks

- Pointer movement over a term opens the preview without activating the side panel.
- Preview images can be clicked to enlarge; Escape returns to the preview, then a second Escape returns focus to the original term.
- Clicking a term continues to open the persistent side panel.
- Keyboard focus opens the preview; ArrowDown moves focus into the article link.
- 390px viewport: title and article row wrap cleanly; footer remains accessible; no horizontal overflow.
- Actual notes page: preview works above the hovered term within the scrolling notes layout.
- Browser console: no errors or warnings in the final preview checks.
- Automated checks: 136 tests across 27 files passed, including concurrent preview/panel request sharing, caching, and retry after failure.
- Production build passed. Existing large-chunk advisory remains.
- Temporary test files/tabs removed, viewport overrides reset, existing local server preserved. No push, commit or deployment performed.

## Follow-up polish / residual gaps

No blocking visual follow-ups. Touch hardware and screen-reader narration were not independently exercised; touch retains the existing click-to-open side panel. Full AMBOSS articles continue to open through the existing article links.

## Suggestions, discussion and short set links — 23 September 2026

- Added question-specific side-panel conversations on practice, question details and marking. Exam controls are disabled until the paper is submitted.
- Browser verification used an isolated origin with synthetic accounts and an in-memory API: suggestion posting, admin resolution/reopening, quoted replies, author-only deletion controls, non-admin moderation hiding, failed-send draft retention, and short whole-set link loading passed.
- Sharing exposes only Copy set link. Short-link resolver tests cover stable codes, renamed/reordered sets, invalid/deleted/ambiguous codes, and read-only resolution.
- 209 unit tests passed; production build passed (existing bundle-size warning only).
- Firestore rules were reviewed but not exercised in a Firestore emulator: this machine has no Java runtime. No live posts, Firebase rule updates, or deployments were performed. Deploy the new rules alongside the release; existing live rules intentionally deny these new shared paths until then.

## Firebase permissions deployment — 23 September 2026

- Deployed only `firestore:rules` to the app's configured Firebase project `saqmd2`, following explicit user authorization. No Git push, website build release, or Netlify deployment was triggered.
- Firebase compiled and released the rules successfully. Re-read the active release and confirmed its source exactly matches the local rules file.
- Nine Firebase Rules API checks passed: authenticated discussion reads; guest denial; own private-note access; cross-account note/answer denial; author deletion; denial of another member's deletion; verified moderator deletion; and denial for an unverified moderator email.
- Saved the previous rules, deployed release metadata, and test results outside the repository under `work/firebase-rules-2026-09-23`. No real discussion posts or practice data were created or modified during verification.
