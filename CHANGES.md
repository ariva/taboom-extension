# CHANGES

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
- Reset scroll pos on dropdown change (58bbff3)
- Keep pre-search scroll positions intact (1c2c3bc)
- Scroll position leaking across filters (f786541)
- Protect and unprotect used the same missleading shield icon. It should have unique icons. (da82622)
- Refresh options page on rules change (96a149a)

### Performance
- Options page re-rendering (d65d782)
- Service worker - tabHistory improvements. (55e99b0)
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
