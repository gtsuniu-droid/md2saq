# SAQ Practice usability audit

23 September 2026. Local changes only. The complete presentation list is preserved, including presentations with no questions currently loaded on a particular device.

1. **Home → choose a session.** The session choices are visible, but the progress fractions previously counted questions in both modes. Whole sets now shows fully marked sets / total nonempty sets. Each set counts only under its primary presentation. Individual questions retains question counts. Selecting Vomiting in a disposable sample library selected its one primary vomiting set, while individual-question mode selected 21 questions carrying that tag. The full list remains available.

   ![Home before changes](/Users/gabe/Documents/Codex/2026-09-21/mmy/work/ux-audit-2026-09-23/01-home-before.png)
   ![Whole-set counts after changes, disposable sample data](/Users/gabe/Documents/Codex/2026-09-21/mmy/work/ux-audit-2026-09-23/05-set-counts-after.png)

2. **Browse → open a presentation or set.** Previously, clickable rows lacked native keyboard semantics and Practice/Exam actions appeared only on hover. Branches are now buttons with expanded state; set and search-result destinations are links with visible focus. Practice/Exam actions remain visible. Starting from Browse now warns before replacing an unfinished session and starts whole-set mode. Primary presentation placement is consistent with Home; secondary tags remain searchable.

   ![Browse before changes](/Users/gabe/Documents/Codex/2026-09-21/mmy/work/ux-audit-2026-09-23/03-sets-before.png)
   ![Keyboard-focused presentation after changes](/Users/gabe/Documents/Codex/2026-09-21/mmy/work/ux-audit-2026-09-23/07-browse-after.png)

3. **Set details → practise or inspect questions.** The timer field lacked an accessible name and question rows were mouse-only. The timer is now named and questions have links. Previously attempted sets offer “Practise again.” The set heading/subtitle shows the primary presentation. Edit set has a primary-presentation selector; moving a set updates that field and its numbering group. The practice toolbar distinguishes Next, Next set and Session summary.

   ![Set details before accessibility changes](/Users/gabe/Documents/Codex/2026-09-21/mmy/work/ux-audit-2026-09-23/08-set-detail.png)
   ![Set details after changes](/Users/gabe/Documents/Codex/2026-09-21/mmy/work/ux-audit-2026-09-23/09-set-detail-after.png)

4. **Admin/Create → add a batch → undo.** New additions are recorded as batches on the current device. Undo latest addition, or Ctrl/Command+Z outside an editor, previews the complete batch before removal. Escape/Cancel dismisses it. Restore removed sets restores a local copy. Ten-set undo/restore and a fresh pasted-set addition were verified in the browser. Save failures release the busy state and preserve unsaved import items; completed items are removed from the pending queue to avoid duplicate retries. Admin selection/filter fields now have accessible names.

   ![Ten-set Undo preview](/Users/gabe/Documents/Codex/2026-09-21/mmy/work/ux-audit-2026-09-23/06-undo-preview.png)

5. **Notes → choose presentation and section.** The existing section tabs, readable content and explicit sharing controls were inspected. No list was shortened, and no notes were removed or changed during the audit.

   ![Notes inspected during this audit](/Users/gabe/Documents/Codex/2026-09-21/mmy/work/ux-audit-2026-09-23/04-notes-before.png)

## Validation and limits

- 170 automated tests across 33 files pass. Production build and whitespace checks pass. The existing large-bundle warning remains.
- Browser testing used disposable data on port 5177; existing user data on port 5173 was not modified. Desktop screenshots mostly use 1280 × 720; the initial Home screenshot is 627 × 828. These are flow evidence, not equal-viewport pixel comparisons.
- This is a focused Home/Browse/set/Create/notes audit, not a complete accessibility certification or an exhaustive review of every feature. Screen-reader speech, all mobile sizes, live cloud deletion, cross-device login and AMBOSS were not exercised.
- Existing sets without an explicit primary presentation use their named presentation branch/bank or, as a fallback, their dominant question tag. This is legacy metadata inference, not clinical review of each case. Admin can correct the primary complaint in Edit set.
- Undo records apply to additions made after this feature is installed, on the device/account that added them. Earlier imports have no batch record. Edited sets or sets with local attempts are protected; newer shared versions are checked before removal. Failed cloud deletions retain local sets and support retry. Previously downloaded copies on other devices follow the existing bank behaviour and are not remotely erased by this feature. Recovery copies stay local and require explicit publishing to share again.
- No push, deployment or live shared-bank deletion was performed.
