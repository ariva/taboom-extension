# CHANGES

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
