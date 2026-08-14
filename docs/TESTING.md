# Testing Taboom - Tabs Manager

Tests run under Node's built-in test runner (`node --test`) — no test framework needed. The UI tests, however, need a DOM implementation (Node has none): they render the real extension pages in [happy-dom](https://github.com/capricorn86/happy-dom) — the one dev dependency `npm install` brings in — with a stubbed `chrome.*` API, so nothing needs a running Chrome.

## Setup

1. Install [Node.js](https://nodejs.org/) 20 or newer (built-in test runner).
2. Install dev dependencies (only `happy-dom`, used by UI tests):

   ```bash
   npm install
   ```

3. Install [`just`](https://github.com/casey/just) — the command runner ([installation guide](https://github.com/casey/just#installation)).
4. Install [`fd`](https://github.com/sharkdp/fd) — the lint step uses it to enumerate JS files.

## Running

```bash
just test     # full test suite
just lint     # syntax-check every JS file + validate manifest.json
just check    # lint + test (also what `just build` runs before packing)
```

Single file / filtered run:

```bash
node --test tests/core.test.js
node --test --test-name-pattern="Service Worker" tests/*.test.js
```

## Test layout

| File | Covers | DOM? |
|---|---|---|
| `tests/core.test.js` | Pure logic in `core/core.js` (eligibility, rules, search, formatting) | no |
| `tests/storage.test.js` | `core/storage.js` defaults merge + save round-trip | no |
| `tests/service-worker.test.js` | `background/service-worker.js` driven by fired chrome events (alarms, messages, menus) | no |
| `tests/sidepanel.ui.test.js` | Side panel rendering, filters, badges, bulk actions, autoscroll | happy-dom |
| `tests/sidepanel-keys.ui.test.js` | Keyboard navigation (`/`, arrows, Enter) | happy-dom |
| `tests/sidepanel-sort.ui.test.js` | Sort orders, window grouping, window dots | happy-dom |
| `tests/options.ui.test.js` | Options page: settings render/save, rules, theme, Saved pill | happy-dom |
| `tests/popup.ui.test.js` | Popup: stats, labels, actions | happy-dom |
| `tests/helpers/ui.js` | Shared harness: loads a page's real `index.html` into happy-dom, provides the `chrome.*` stub (capturing events, call log) | — |

## Conventions

- Test names are prefixed by group: `Core - `, `Core - Storage - `, `Service Worker - `, `UI - Sidepanel - `, `UI - Options - `, `UI - Popup - `, description capitalized.
- Each test file runs in its own node process, so page-script module state never leaks between files; tests **within** one file share the imported page and run in order.
- UI tests import the real page script after `loadPage(...)` sets up DOM + chrome globals; interactions are plain DOM events.
- Chrome fires some listeners without awaiting them (e.g. `onAlarm`) — `await tick()` before asserting on their effects.
- No chrome mocks in `core/` tests: `core/core.js` stays `chrome.*`-free by design so it tests as plain functions.
