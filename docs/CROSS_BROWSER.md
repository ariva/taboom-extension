# Chrome and Firefox from one source

What a developer must know before building one Manifest V3 extension for both browsers, and how Taboom does it. The first part is general; the second maps every point onto this code. Build commands are in [BUILD.md](BUILD.md), the code layout in [ARCHITECTURE.md](ARCHITECTURE.md), loading the add-on in [LOCAL_DEV.md](LOCAL_DEV.md).

## The high view

### 1. Background model
- Chrome runs the background as a **service worker**: it dies after ~30 s idle, has no DOM, no `window`.
- Firefox runs an **event page** (`background.scripts`): longer-lived, with a DOM. Firefox has no extension service workers ([bug 1573659](https://bugzilla.mozilla.org/show_bug.cgi?id=1573659)).
- Write for the stricter one. Register every listener synchronously at top level, keep no decision state in module variables, persist through `chrome.storage` and `chrome.alarms`. Such code runs unchanged as an event page.

### 2. Namespace and promises
- Firefox MV3 exposes `chrome.*` and returns promises from it. `browser.*` is Firefox-native; Chrome does not have it.
- Write `chrome.*` with `await`. No polyfill, no `browser.*` rewrite. Callback style works in both but buys nothing.

### 3. Manifest
- An unknown permission makes Firefox **refuse to load** the add-on; Chrome ignores unknown keys. Generate one manifest per browser from one source instead of maintaining two files.
- Firefox-only and required: `browser_specific_settings.gecko.id` (the add-on's identity — permanent after the first AMO upload; a new id is a new, unrelated add-on), `strict_min_version`, `data_collection_permissions` (every AMO submission since 2025-11).
- Chrome-only: `side_panel`, `minimum_chrome_version`, `options_page`, the `favicon` permission. Firefox-only: `sidebar_action`. Both: `options_ui` with `open_in_tab`.

### 4. UI surfaces
- Side panel vs sidebar: a different API (`chrome.sidePanel` vs `sidebarAction`) and different semantics. The Firefox sidebar is per window and opens in the **active** window only (`sidebarAction.open()` takes no window); the toolbar click needs your own `action.onClicked` listener, where Chrome has `setPanelBehavior({ openPanelOnActionClick })`.
- Favicons: Chrome serves `_favicon/` from its local cache; Firefox offers nothing without a network request to the site.
- Native form controls render differently (the clear ✕ of `<input type=search>`, selects, checkboxes). Look at both.

### 5. API gaps — check compatibility before relying on anything
- Missing or late in Firefox: `tabs.onReplaced`, split view (Chrome 155+), `tabGroups` (Firefox 139+), `offscreen`, parts of `declarativeNetRequest`; `userScripts` differs.
- Missing in Chrome: `browser.*`, `sidebarAction`, `contextualIdentities`, the `menus` extras.
- Feature-detect (`"sidePanel" in chrome`) in **one** platform module. Never branch on the user agent.

### 6. Store review is a build constraint
- AMO lints the uploaded code **statically**: it flags Chrome-only API calls even behind a runtime guard, flags every `innerHTML` assignment whose right-hand side is not a literal, and demands a source archive plus build instructions for bundled code. Compile the other browser's branches out (build-time constants) or expect the same warnings in every review.
- Chrome Web Store: automated plus manual review, less code-level scrutiny, stricter on the justification of each permission.
- The Firefox add-on id is forever; Chrome's id derives from the signing key.

### 7. Tooling and testing
- Loading: Chrome's unpacked folder persists across restarts; a Firefox temporary add-on is gone after a restart (`web-ext run` gives a dev loop on a throwaway profile).
- Automation: Playwright drives Chromium extensions only. Firefox needs WebDriver BiDi or `web-ext` — expect to write a harness.
- A Firefox sidebar page takes no focus under automation: anything committed on blur needs another route (a popup window).
- Devtools: Chrome `chrome://extensions` → the service worker link; Firefox `about:debugging` → Inspect.

### 8. Minor traps
- `alarms`: Chrome MV3 enforces a 30 s minimum, Firefox allows shorter — do not depend on it.
- `storage.session` exists in both but came late to Firefox (115+).
- Keyboard commands: Chrome caps the suggested keys at 4; a Firefox conflict is silent and the user resolves it in `about:addons` → Manage Extension Shortcuts.
- A discarded tab keeps its id in Firefox; Chrome swaps it and fires `tabs.onReplaced`.

### Rule of thumb
Design for Chrome's service-worker constraints, Firefox's manifest strictness and AMO's static linter. Isolate every browser difference in one seam module; keep everything else browser-agnostic.

## How Taboom does it

| Point | Here |
|---|---|
| Background model | `src/background/service-worker.ts` registers listeners synchronously and holds no decision state (`sessionStore` / `localStore`); the same bundle is Chrome's service worker and Firefox's event page. |
| Namespace | `chrome.*` everywhere; `browser` is read in one place, `src/lib/platform/capabilities.ts`, for `sidebarAction`. |
| Manifest | `src/manifest.ts` — `manifest(version, target)`: one shared body, a Chrome tail (`minimum_chrome_version`, `service_worker`, `side_panel`, `sidePanel` + `favicon`) and a Firefox tail (`background.scripts`, `sidebar_action` with `open_at_install: false`, `browser_specific_settings.gecko` with `GECKO_ID`, `strict_min_version` 140, `data_collection_permissions: none`, `gecko_android.strict_min_version` 142). `TARGET=firefox` picks it; `tests/structure/manifest.test.ts` pins both. |
| UI surfaces | `src/lib/platform/panel.ts`: `openPanel` (`sidePanel.open` / `sidebarAction.open`), `openPanelOnActionClick` (Chrome's panel behaviour), `toggleSidebarOnActionClick` (Firefox's `action.onClicked` listener, registered at worker start). `platform/favicon.ts`: `faviconUrl` is `undefined` without a cached store → the row shows the host's initial. The search box carries its own clear ✕ in both browsers. |
| API gaps | `capabilities`: `sidePanel`, `sidebar`, `cachedFavicons`, `tabReplacement`, `tabGroups`; `tabs.onReplaced?.addListener`; split view hidden without the API. Browser-only names are allowed only in `src/lib/platform/` and `src/manifest.ts` (`tests/structure/lib-boundary.test.ts`). |
| Store review | Build-time `__CHROME__` / `__FIREFOX__` (Vite `define`, `build-target.d.ts`) fold the other browser's branch out of `chunks/panel.js`, so AMO sees no `sidePanel` call; `tests/structure/release-snapshot.test.ts` runs `web-ext lint` on the Firefox zip and asserts it. SVG icons go through `setSvgMarkup` (DOMParser), never a non-literal `innerHTML`. `just source-zip` makes the source archive. A `vite build --watch` started before `define` existed ships the literals and the worker throws `ReferenceError` — restart the watcher after a config change ([LOCAL_DEV.md](LOCAL_DEV.md)). |
| Tooling and testing | `just dev` / `just dev-firefox` into `dist/dev-chrome` / `dist/dev-firefox`; `just firefox-run` for the throwaway profile. The unit suite runs a 4th time against a Firefox-shaped mock (`tests/helpers/chrome-mock.ts`); the browser tier runs on Chromium and Firefox; the demo and perf tiers drive a real Firefox through our own WebDriver BiDi client (`demo/firefox/`: prepared profile, `webExtension.install`, a bootstrap tab that opens the panel into a popup window for focus). |
| Minor traps | Keep-alive's sweep runs on a 30 s alarm in both; three suggested keys out of Chrome's four; the Firefox shortcut is listed under `about:addons` → ⚙ → Manage Extension Shortcuts. |
