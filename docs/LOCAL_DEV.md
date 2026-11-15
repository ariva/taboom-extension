# Local development: build and load Taboom - Tabs Manager

Taboom - Tabs Manager is written in TypeScript and built with [Vite](https://vite.dev) into a plain, readable (unminified) extension folder that Chrome loads directly.

## Requirements

- Google Chrome 121 or newer (the extension relies on `Tab.lastAccessed`).
- [Node.js](https://nodejs.org/) 24 LTS (`.nvmrc` pins it — `nvm use`) and `npm install`.
- [`just`](https://github.com/casey/just) — the command runner behind every task below ([installation guide](https://github.com/casey/just#installation)).

## Build it

```bash
npm install
just dev      # builds dist/dev-chrome and keeps rebuilding on every save (leave it running)
```

One-off production build without the watcher: `npx vite build` → `dist/chrome` (`TARGET=firefox npx vite build` → `dist/firefox`). All build commands: [BUILD.md](BUILD.md).

## Load unpacked (development install)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the built folder — the one containing `manifest.json`:

   ```text
   dist/dev-chrome   (while developing, from `just dev`)
   dist/chrome       (production build)
   ```

5. The **Taboom - Tabs Manager** card appears. Pin the toolbar icon via the puzzle-piece menu if you want quick access.

### Firefox (temporary add-on)

**Restart the watcher after a change to `vite.config.ts`, `src/manifest.ts` or anything under `tooling/`** — `vite build --watch` never re-reads its config, so a running `just dev` keeps building with the old one: after the `__CHROME__` / `__FIREFOX__` constants arrived, a watcher started before them left the identifiers unreplaced and the worker died at start with `ReferenceError: __FIREFOX__ is not defined` (toolbar button dead, nothing after it registered). Ctrl+C, run `just dev` / `just dev-firefox` again, press **Reload** on the extension.

Firefox has no persistent "load unpacked". Build the Firefox flavour (`just dev target=firefox` while developing → `dist/dev-firefox`; `TARGET=firefox npx vite build` → `dist/firefox`), then `about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick the `manifest.json` in that folder. The add-on is gone after a Firefox restart — load it again, or use `just firefox-run`, which starts a throwaway profile with the add-on and reloads it on every rebuild. The panel is in the sidebar: the toolbar button toggles it. What else differs between the two browsers for a developer: [CROSS_BROWSER.md](CROSS_BROWSER.md).

## Verify it works

1. Click the Taboom - Tabs Manager toolbar icon → side panel opens listing all tabs.
2. Type in the search box → list filters instantly.
3. Hover a non-active tab row and click the ⏸ button → the tab gets a `SNOOZED` badge and Chrome shows it discarded (its title turns faded in the tab strip).
4. Click that tab in Chrome → it reloads normally.

## After changing code

With `just dev` running and `dist/dev-chrome` loaded, nothing: every save rebuilds in well under a second and the loaded extension updates itself —

- a change to a page (side panel / options: TypeScript, HTML, CSS) reloads the open extension pages;
- a change to the service worker, the manifest or shared code reloads the whole extension (the side panel comes back through the restore-panels setting).

Type errors stream in the same terminal (`tsc --watch`) — the build itself never blocks on them, `just check` does.

The reload signal reaches open extension pages only. If no side panel or options page is open when you change the service worker, reload once by hand: `chrome://extensions` → the circular **reload** arrow on the card.

Service-worker logs: click **service worker** link on the extension card to open its DevTools console. Side panel / options: right-click inside them → Inspect.

## Keyboard shortcuts

Defaults (customize at `chrome://extensions/shortcuts`):

| Command | Default |
|---|---|
| Open Taboom - Tabs Manager side panel | `Ctrl+Shift+Space` (`Cmd+Shift+Space` on Mac) |
| Tab history: back to the previous tab | `Ctrl+Shift+,` (`Cmd+Shift+,` on Mac) |
| Tab history: forward to the next tab | `Ctrl+Shift+.` (`Cmd+Shift+.` on Mac) |
| Snooze current tab | unassigned |
| Toggle site protection for current tab | unassigned |

Chrome may refuse the suggested key if another extension already claims it — assign manually in that case.

## Packing a zip (optional)

```bash
just build    # release checks + dist/taboom-tabs-manager-v<version>-chrome.zip and …-firefox.zip (readable, unminified — the store upload)
```

Needs, on top of the requirements above: [`jq`](https://jqlang.github.io/jq/), `zip`, `unzip`, `git`, and Playwright's Chromium (`npx playwright install chromium`). What the release checks are, every other build command, and the optional minified build are described in [BUILD.md](BUILD.md).

The zip is only needed for distribution (e.g. Chrome Web Store upload). Local development always uses Load unpacked.

## Troubleshooting

- **"Manifest file is missing or unreadable"** — you selected the repository root or a parent folder; select `dist/dev-chrome` (or `dist/chrome`), and build first if it does not exist.
- **Side panel button does nothing** — Chrome older than 121; check `chrome://version`.
- **Snoozing the active tab switches to a neighbor tab first** (or opens a new tab if it's the only one in the window) — Chrome cannot discard the active tab, so focus must move before the discard.
- **Errors after editing code** — check the red **Errors** button on the extension card, fix, reload.
