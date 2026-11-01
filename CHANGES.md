# CHANGES

## v1.0.8 — 2026-11-01

### Summary
Shared view across side panels, split view on current Chrome, a faster panel and worker, and a long round of side panel fixes

### New Features
- Split view support on latest Chrome browsers (b0c1bae)
- Shared or independent search / filter / scope / sort across side panels (83d388c) (8a0c8cf)

### Fixes
- A parked restore dropping the wrong tab when the snapshot was edited meanwhile, keep-alive writers on one chain, the current window among normal windows only (9bf37d7)
- Settings feedback and accessibility, panel empty-list messages, a badge flash for a refused keyboard snooze (661d372)
- A refresh in flight reverting the panel's own ui write, and a second own write's echo read as foreign (60773df)
- Park, restore and move parked answering ok when nothing happened (bcfbdfb)
- Esc in a dialog or picker clearing the search, a slash stolen from text fields, the Tags view blind in the Parked scope, Enter dead on a parked row (23914ad)
- Settings tag chips and keep-alive edits overwriting a list changed meanwhile (1f50a68)
- A tagless or switched-off tagged-page rule lost on Restore last removal (e2f5aa0)
- A theme or zoom write from Settings re-applying the stored filter over a scope that overrides it (b35a9ad)
- Drag state outliving a re-rendered drag, an older refresh landing last, onReplaced and session writes in the panel, removeAll below Chrome 123 (fd94a56)
- A second side panel not showing a window rename, color or pin made elsewhere (6801430)
- A list context menu closing on every render, title ticks included (c00da07)
- A double-click on Settings' Restore last removal popping two removals (09dcb2e)
- Quick-launch Pins and Groups menus acting on the parked snapshot while the list shows parked windows (351c1c1)
- Failed panel actions reporting nothing, a bulk close stopping at a closed tab, and a history jump dropping a tab over a focus failure (a50f607)
- Settings fields losing typed text on an external re-render, and a removed tag lingering in the panel's Tags filter (f8ab41f)
- A parked selection pointing at other tabs after the parked list changed elsewhere (36d71a9)
- Moving parked tabs dropping them from the snapshot when nothing opened (6660483)
- The worker's settings reaction throwing on Delete all and leaving the keep-alive sweep alarm armed (aa0cf94)
- A re-render mid-edit saving a half-typed inline value, and two Settings edits overwriting a list changed meanwhile (1541e8c)
- Tag globs with many stars freezing the panel, Settings and the worker (5b9ffc1)
- Clear the stale panelOpen flag when a window closed and reopened in this session reclaims its profile, so the restore banner does not offer it (c5aeaa0)
- Fire-and-forget messages leaking unhandled rejections when the worker is gone or the extension context is invalidated (ea9dffd)
- A stray New Tab left after snoozing a window's only tab fails (bc70b20)
- Reconnect the side panel port at once after a worker idle-kill (d77f2b5)
- Feature flags stuck disabled when the first features.json read fails during an extension update (043cf03)
- Window name/color edits silently dropped after clearing storage.local while the session map still holds the logical id (6775656)
- The keep-alive reload burst after wake or restart by re-timing every overdue mark in list (d744109)
- Clear tab history on browser startup since Chrome reuses tab ids across sessions (548f8e3)
- Restore losing a parked window when an address or the target window fails: open tabs first, then prune the snapshot per opened tab (d76f0c7)
- Window names lost on session restore - more predictable window name preservation (7e23e68)
- Settings re-renders only the card whose key changed and leaves an open editor alone (fec91dc)

### Performance
- Panel per-render cost: window sort ranked once, tag matching parsed once per tab, one message per bulk snooze (898c8f0)
- Worker wakes and per-event work (1892e70)

### Other
- Performance tier - nine measurements at 2000 tabs against the built extension, a history line per run, a compare command (9298d50)
- Comments and docs that no longer matched the code, an explicit startup order, no non-null assertions left (e952709)
- Panel and Settings reuse: one pluralizer, one id lookup, cached window maps, one Restore button, one ui patch writer; closeTabs asks through the in-panel dialog (8dd5c49)
- Renumber the ticket references in docs and test comments (106b998)
- Isolate each init step in the worker's lifecycle pass so one rejecting step is logged and the rest still run (0badb40)
- Route every protection-rule write through queued storage writers (7992faa)
- Rework tag page rules (e2a8d51)

## v1.0.7 — 2026-10-25

### Summary
Tags menu and settings polish, split menu label fixes

### Fixes
- Clarify the split menu labels when the split is happening across the different windows (9d9e77b)

### Other
- UI/UX tags improvements - one select/add context menu, add remove tag, sorting in tags list in settings and minor bug fixes (93fd276)
- Add support section to the `README.md` (87c8bb5)
- Release tools to have a possibility to record a demo (6215868)

## v1.0.6 — 2026-10-18

### Summary
Split view, snooze-now actions and side panel fixes

### New Features
- Split view (experimental, Chrome 155+) — pair two tabs from the row menu, badge them, unsplit (6010cfc)
- Add manual snooze now button (4107eeb)

### Fixes
- Fix prev/next split action (7a12255)
- Treat session-restored "discarded" or status "unloaded" tabs as snoozed everywhere (1656e79)
- Fix bug where action window was auto-closed on sidebar actions icon click (24e3119)
- Make on-demand snooze ignore the inactivity threshold (698d312)
- Reveal the active tab when the panel opens (e7853f9)

### Other
- Rename `docs/INSTALL.md` to `docs/LOCAL_DEV.md` (3b11f58)

## v1.0.5 — 2026-10-18

### Summary
Custom tab tags, parked windows and a demo-driven documentation refresh

### New Features
- Add custom tab tags support (dcab258)
- Add parked windows (b27f75f)
- Show parked windows in the quick launch (d77524f)
- Add parked windows as move targets in the tab menu (2feefd7)
- Show the extension version in the settings heading (7612b1a)
- Options - protected sites: hover a chip for "Exact host / Domain and its subdomains / Exact page: <pattern>" (92a2c58)

### Fixes
- Hide the single-window Windows view and empty Groups view from the quick launch (fe86a9f)
- Rename the "All windows" scope option to "All open windows" (f758fbb)
- Tags polishing (04d31a6)
- Rework the Tags… picker and New tag dialog flow (29e7162)
- Add a titled header to the quick launch popover (6c04db9)
- Restore defaults / Delete all wording matches what they touch (96273fd)

### Other
- Add a support section to the `README.md` (fa93df4)
- Add the demo recorder: a synthetic world filmed scene by scene into the feature demo MP4 and GIF (742bcc0)
- Re-record the demo on every `just build` (`SKIP_DEMO=1` skips it) (742bcc0)
- Add `just publish` as the release command: `just build` (7d9a825)
- Add feature stills: named screenshots per scene published to `docs/assets/features/` (742bcc0)
- Add `docs/FEATURES.md`, one picture per feature from those stills (742bcc0)
- Add quick actions image to the `README.md` (f1a432f)
- Reorder settings cards - Interface, Automatic Snooze, Customizations, Protected Sites, Keep Tabs Alive (ad10b97)
- Versioned release zip names (c186dfd)

## v1.0.4 — 2026-10-11

### Summary
Duplicate tab cleanup, quick-actions menu and per-mark keep-alive reload targets

### New Features
- Replace the side panel gear with a ☰ quick-actions menu (Open Settings, Cleanup Duplicates) that closes other popups (1b86e0f)
- Add duplicate cleanup functionality and Dupes view to the quick launch window (2856259)
- Keep-alive reloads one tab per mark (pinned first, else first found) with a per-mark Tabs dropdown for reloading all (1e34e55)

## v1.0.3 — 2026-10-10

### Summary
Keep tabs alive feature, editable protected sites and side panel history-scroll fix

### New Features
- Keep tabs alive — mark pages to reload every N minutes and skip auto-snooze, managed from settings, side panel and page context menu (ce01d44)
- Restrict keep-alive marking to a single tab so one right-click cannot mark a whole selection for periodic reloads (9ca2c41)
- Options - keep-alive: add url input with Add button (d5161c7)
- Protected sites: remove all with restore last removal, click-to-edit patterns, and a shared undo stack with keep-alive plus a clear-restore-data button (cf4167e)

### Fixes
- Side panel menu changes for keep-alive items (627c53a)
- Sidepanel not scrolling to the tab activated by Ctrl+Shift+,/. and docs consolidate README and USAGE screenshots under docs/assets (d980785)

### Other
- Features in keep-alive: clear all + restore last removal, click-to-edit mark address, fragment-exact matching, sweep title refresh, and wider options page (9520a94)
- Move the experimental switch and its options to the end of the Customization card (d68ca9d)
- Consolidate public/icons and dev-assets into one icons/ folder (521e569)

## v1.0.2 — 2026-10-07

### Summary
Browser-wide keyboard shortcuts for tab history

### New Features
- Add Ctrl+Shift+,/. (on mac: Command+Shift+,/.) commands for tab history (71bcf84)

## v1.0.1 — 2026-09-27

### Summary
Exact-URL protection, Copy URL in the context menu and zoom presets

### New Features
- Add exact-URL protection rules (1e50f5a)
- Add "Copy URL" to the side panel row context menu (e160964)
- Add zoom presets in options (c12ba60)

## v1.0.0 — 2026-09-26

### Summary
Migration of the codebase from JSDoc to TypeScript

### Other
- TS code migration: jsdoc -> typescript + refactor code (fca2f7c)

## v0.2.17 — 2026-09-20

### Summary
Quick launch bug fixes and group features

### New Features
- Add generic askDialog modal and use it to name new tab groups (e195cf8)
- Add reorder for groups in quick-launch window / groups tab (d85bd90)
- Create tab groups from the quick-launch Groups view (760a003)

### Fixes
- Fix inline edit closing the quick-launch window (9a13e4a)
- Re-pin tabs after cross-window move (dc98a18)
- Quick-launch "Rename group…" edits the group name inside the popover row instead of the sidebar header (a17d199)
- Close context menu and cancel in-progress rename when switching windows/groups/pins view (2ae3d16)

### Other
- Share one window ordering between the windows popover and the row menu's move-to submenu (3feb9e8)

## v0.2.16 — 2026-09-19

### Summary
Tab groups support, quick jump views and restore banner fixes

### New Features
- Add Windows | Groups | Pins views to the quick jump popup (f3cf4cd)
- Add Chrome's Tab Groups support (2cff397)
- Add pin/unpin tab to the list context menus (e79f439)

### Fixes
- More predictable way of showing restore banner - no more race condition (ae31626)
- Fix navigation history showing the same tab repeated consecutively after removals and id swaps (004add6)

### Other
- Shrink images in README.md (80db0ac)
- Show extension version as hover text on the sidebar heading (34cd2c8)
- Add personal non-commercial LICENCE with commercial-use-by-permission clause (bf91254)
- README.md updates - new images, new tab-groups permission (956c990)
- Rework group-by-window nesting layout (f62397e)
- Better time handling on awoken tabs (c9abe17)

## v0.2.15 — 2026-09-12

### New Features
- Add window pin feature (27976db)
- Redesign tab list style (07e88d7)
- Add possibility to have custom window names/colors, windows list popup for easy switch (24649d0)
- Make [Same as window] the default in-window tab order for new and existing installs (8d7b3cb)
- Differentiate local build and official releases, have dev banner for local builds, allows easier local development (b0cbbe4)

### Fixes
- Replace native toolbar select popups with a custom dropdown list that positions correctly in the side panel (6e10880)
- Always show the tab count in window-menu action labels (f4cb6e9)
- Display context-menu submenus correctly based width (d3e4e5d)
- Keep the windows popover open through color picks and rename windows inline (a62a67a)
- Fix duplicate-id and cannot-find menu errors (d24f715)
- Keep the current tab focused on window switch (4b9c81e)
- Fix overlapping navigation-stack menu rebuilds (5a307e9)

## v0.2.14 — 2026-08-30

### New Features
- Let users opt out of the side-panel restore banner via a options setting (8fee838)
- Persist per-window side-panel state (5a622ec)
- Allow reordering tabs by drag in same-as-window mode (40d985c)
- Let users control tab order inside window groups from options or a new header right-click menu (11136c9)
- Add more tab context-menu actions in side-bar (a35acd1)
- Add cross-window tab moves: drag rows onto any target window (1714a1d)

### Fixes
- Make header right-click act on the selection if any of items are selected (975f894)
- Make context-menu hover highlight visible in dark theme (d20ffab)
- Keep multi-select intact when closing or snoozing individual tabs (0f3ad87)

### Other
- Build tools latest-tag usage change (4fbb233)

## v0.2.13 — 2026-08-23

### New Features
- Add group by URL - allows to spot url duplicates (35d7a2c)
- Add experimental fuzzy search - no typo tolerance (f16a4de)
- Add option to hide the new-version update banner (76e3899)
- Rework options change log logic - show expanded, reuse pagination (5ed5691)

### Fixes
- Keep recent release notes expanded in options (6efbc0f)
- Hide sort-direction button when a grouped sort has only one group (c1a8695)

### Other
- Update build scrips - add checks to validate build's integrity (52e164a)

## v0.2.12 — 2026-08-20

### New Features
- Hidden-matches search behavior as an opt-in Customization dropdown and the feature is stabile. (9b2a3e5)

## v0.2.11 — 2026-08-20

### New Features
- Per-version update-banner dismissal functionality (edc1d07)

## v0.2.10 — 2026-08-20

### New Features
- Group by domain, plus options Customization section (fddeb4d)
- Added sort-direction button (754ad4f)
- Search-scoped group folding plus a hover tooltip (d65fbb8)
- Experimental feature - group tabs by title — biggest groups first. (216a8df)
- Per-window select checkbox in group headers plus header polish — dot indicator, accordion chevron, spacing. (0686858)
- Control individual items in navigation history - have ability to remove from the list (38ce277)
- Pagination of the what's-new items. (d392d3e)
- Close sidebar popups on focus loss (c2abbb1)
- Traditional/compact navigation stacks behind per-mode flags, options dropdown (990c6e6)
- Add restore default settings and clear protected sites actions in options (937c47a)

### Fixes
- Right-click on nav arrows toggles the history popup (7bbac90)

## v0.2.9 — 2026-08-19

### New Features
- Live-sync open history popups across windows (a57aba2)
- Promote prev/next navigation buttons to stable. (079649c)
- Hold(or right click) prev/next to see navigation history pop-up (5c9a445)
- Experimental button to show/hide history popup (086aa21)
- Experimental feature - make auto-jump to All filter if current search has no results (012760b)
- Search-aware filter counts (7f055c4)

### Fixes
- Snoozed tabs showing as "(closed tab)" in history — discard replaces the tab id (d698ac8)
- Wrong tab in history after closing the current one, rework pushHistory to move the cursor onto in-stack tabs (66d2a41)
- Esc closes navigation stack popover (ab583db)
- Closed tabs lingering in navigation stack (32bf3d0)
- Exact scroll restores with content-visibility (97e316f)

## v0.2.8 — 2026-08-18

### Fixes
- Reset scroll pos on dropdown change (3d9f0a7)
- Keep pre-search scroll positions intact (1c2c3bc)
- Scroll position leaking across filters (f786541)
- Protect and unprotect used the same missleading shield icon. It should have unique icons. (da82622)
- Refresh options page on rules change (96a149a)

### Performance
- Options page re-rendering (5058ed2)
- Service worker - tabHistory improvements. (1535851)
- Misc render trims (9a17833)
- Faster panel open. Promote SIDEBAR_KEYBOARD_NAVIGATION to stable. (e58b9f8)
- Double render after filter/scope/sort clicks (4ab9702)
- Skip layout/paint of offscreen rows (585c809)
- Batch list rendering into a DocumentFragment (a85b1f1)
- Replace per-row DOM construction with template cloneNode (ea3c3ca)
- Replace per-row listeners with one delegated click handler (e571c0f)
- Cache per-tab (89161ee)
- Added possibility to do perf analysis while in dev mode locally - disabled by default (be7e33d)

### Other
- Add typecheck tooling and annotations (0b58375)
- Keyboard navigation is experimental feature (df1f61b)
- Added experimental features support. (e75e678)

## v0.2.7 — 2026-08-16

### New Features
- Notify about pending extension updates (32a1035)
- Render few latest release notes in options (dfd13c6)
- Suppress collapse/expand-all icon for a single window (316413e)

### Fixes
- Bug where bottom actions part was not responsive (bb6eaec)

### Other
- Deleted popup code, tests, and docs mentions - shows directly side-panel on extension's icon click (78a68e9)

## v0.2.6 — 2026-08-15

### New Features
- Added per-group collapse/expand in window view (572c52c)
- Number windows sequentially (current = #1) and format headers as [Window #N - visible_tabs/total] (3a00896)
- Show visible / total tab counts in window group headers (b36f2a9)

### Fixes
- Bottom buttons disappearing (79e6782)

### Other
- Refactoring of options and popup for better code flow and testability (4d7df68)
- Refactoring of sidepanel for better code flow and testability (0a5d17d)

## v0.2.5 — 2026-08-14

### New Features
- Added grouping by window (e1ae9ea)
- Added multi-window visual identifier (f3e798f)

### Fixes
- List not auto-scrolling to new tab's position (bee76d5)

### Other
- Added TESTING.md doc (5e9b10b)
- Updated local instructions in INSTALL.md (4dd5e2c)
- Added link to chrome extension store in README.md (65ff893)
- Added more tests (3127785)

## v0.2.4 — 2026-08-14

### New Features
- Added wake bulk action (3830836)
- Enable to switch themes in options (24d6124)

### Other
- Restyle active-tab indicators (16e046e)

## v0.2.3 — 2026-08-12

### Fixes
- Performance fix, more than 100 tabs - make it snappy (6aa82d9)
- Vertical align fix for icons at the side menu (81b1538)

### Other
- Nicer options design (1c3534f)
- Improve styles, refactored structure to make it more predictable (f286e5e)

## v0.2.2 — 2026-07-03

### Docs
- README.md - pin extension text (80fbe9a)

### Other
- Added .gitignore file (720120b)
- Side bar icons unification - nicer design (fa02223)
