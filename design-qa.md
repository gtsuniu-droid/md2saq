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
