# CHANGES

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
