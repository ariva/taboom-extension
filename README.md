# Taboom - Tabs Manager - Chrome Extension

Search, protect, and snooze inactive Chrome tabs.

Taboom - Tabs Manager frees memory by snoozing (discarding) tabs you haven't used in a while — they stay in the tab strip and reload when clicked, nothing is ever closed automatically. A side panel lists all your tabs with instant search, filters, and bulk actions; sites that lose state on reload can be protected from snoozing. TypeScript, no runtime dependencies, runs fully locally with no telemetry.

## Installation

### Chrome Web Store
* **[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/taboom-tabs-manager-by-ar/dllcchbdnomgagjlongoanjgolnjnegg?hl=en)**

### Local Installation
* Instructions: [docs/INSTALL.md](docs/INSTALL.md) — load unpacked in Chrome, requirements, troubleshooting

## Features

- **Side panel tab manager** — search across title/URL/hostname, filter by Awake / Snoozed / Protected, sort, and bulk snooze/protect/close.
- **Automatic snooze** — periodically discards tabs inactive past a configurable threshold, skipping pinned, audible, active, and protected tabs.
- **Site protection** — exclude sites (`mail.google.com`, `*.github.com`) or one exact page (`https://app.example.com/board`) from snoozing, also shielding them from Chrome's own Memory Saver.
- **Keep tabs alive** — some sites log you out after a few idle minutes, dashboards go stale once the tab sleeps; mark such pages and they reload on a timer (session renewed, data fresh) and are never auto-snoozed.
- **Context menu and keyboard shortcuts** for quick per-tab actions; `Ctrl+Shift+,` / `Ctrl+Shift+.` step back / forward through the tab history from any tab.

## Privacy first

- Collects nothing, tracks nothing — your browsing is yours
- Everything stays on your device
- No accounts, no analytics, no servers
- Open source

## Permissions

Taboom is a privacy-first extension. It requests the bare minimum Chrome permissions it can function with — no host permissions, no `scripting`, no content scripts, and it makes zero network requests; everything runs locally, and it never has access to the content of the pages you browse.

| Permission | Why it's needed |
|---|---|
| `tabs` | List tabs (title/URL) in the side panel, snooze (discard), activate, and close them |
| `tabGroups` | Show Chrome tab groups (title, color, collapsed) in the list, rename/recolor/collapse them, move tabs in or out |
| `storage` | Save your settings and protection rules locally (`chrome.storage.local`) |
| `alarms` | Run the periodic automatic-snooze check and the keep-alive reload sweep (survive service-worker sleep) |
| `contextMenus` | Right-click menu: snooze this tab, protect this site, keep this tab alive |
| `sidePanel` | Show the tab manager in Chrome's side panel |
| `favicon` | Show tab favicons from Chrome's local cache — no request ever goes to the site |

Nothing else is requested: Taboom cannot read or modify page content, cannot see your browsing beyond open tabs' titles/URLs, and sends nothing anywhere.

## Screenshots

Side panel:

<p>
  <img src="docs/assets/sidemenu_quicklaunch.png" alt="Side panel - Quick Launch" width="360">
  <img src="docs/assets/sidemenu.png" alt="Side panel" width="360">
</p>

Options page:

<img src="docs/assets/options.png" alt="Options" width="460">

## Documentation

- [Installation](docs/INSTALL.md) — load unpacked in Chrome, requirements, troubleshooting.
  After installing, pin the Taboom - Tabs Manager icon via Chrome's puzzle-piece (🧩) menu so the side panel is always one click away.
- [Usage](docs/USAGE.md) — concepts, side panel, automatic snooze, protection rules, verifying freed memory.
- [Building](docs/BUILD.md) — every build command, what a build produces, the dev loop, the release checks, the optional minified build (with measurements).
- [Architecture](docs/ARCHITECTURE.md) — how the code is layered: service worker, side panel, options, the generic library, build and release.
- [Testing](docs/TESTING.md) — the four test tiers (unit, ui, real-browser, e2e), running them, layout and conventions.

## Licence

Free for personal, non-commercial use. Commercial use requires explicit permission from Arunas Ivanauskas (arunas.work.hg [ AT ] [g] [m] [a] [i] [l] [.] [c] [o] [m]). See [LICENCE](LICENCE).
