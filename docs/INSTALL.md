# Installing Taboom - Tabs Manager Locally

Taboom - Tabs Manager is plain JavaScript with no build step — the repository folder loads directly into Chrome.

## Requirements

- Google Chrome 121 or newer (the extension relies on `Tab.lastAccessed`).
- Nothing else for loading the extension itself.

## Load unpacked (development install)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this extension's root folder — the one containing `manifest.json`:

   ```text
   taboom-extension/chrome
   ```

5. The **Taboom - Tabs Manager** card appears. Pin the toolbar icon via the puzzle-piece menu if you want quick access.

## Verify it works

1. Click the Taboom - Tabs Manager toolbar icon → small popup with current-tab actions.
2. Click **Open Taboom** → side panel opens listing all tabs.
3. Type in the search box → list filters instantly.
4. Hover a non-active tab row and click the ⏸ button → the tab gets a `SNOOZED` badge and Chrome shows it discarded (its title turns faded in the tab strip).
5. Click that tab in Chrome → it reloads normally.

## After changing code

1. Go to `chrome://extensions`.
2. Click the circular **reload** arrow on the Taboom - Tabs Manager card.
3. Reopen the side panel / popup (already-open extension pages keep old code until reopened).

Service-worker logs: click **service worker** link on the extension card to open its DevTools console. Side panel / popup: right-click inside them → Inspect.

## Keyboard shortcuts

Defaults (customize at `chrome://extensions/shortcuts`):

| Command | Default |
|---|---|
| Open Taboom - Tabs Manager side panel | `Ctrl+Shift+Space` (`Cmd+Shift+Space` on Mac) |
| Snooze current tab | unassigned |
| Toggle site protection for current tab | unassigned |

Chrome may refuse the suggested key if another extension already claims it — assign manually in that case.

## Packing a zip (optional)

Prerequisites:

- [`just`](https://github.com/casey/just) — command runner driving lint/test/build (see its [installation guide](https://github.com/casey/just#installation)).
- Node.js + `npm install` — installs the test-only dev dependencies (`happy-dom`); `just build` runs the test suite before packing.
- [`fd`](https://github.com/sharkdp/fd) — used by the lint step to enumerate JS files.

```bash
npm install
just build    # lint + test + dist/tabs-manager.zip
```

The zip is only needed for distribution (e.g. Chrome Web Store upload). Local development always uses Load unpacked.

## Troubleshooting

- **"Manifest file is missing or unreadable"** — you selected a parent folder; select the folder that directly contains `manifest.json`.
- **Side panel button does nothing** — Chrome older than 121; check `chrome://version`.
- **Snoozing the active tab switches to a neighbor tab first** (or opens a new tab if it's the only one in the window) — Chrome cannot discard the active tab, so focus must move before the discard.
- **Errors after editing code** — check the red **Errors** button on the extension card, fix, reload.
