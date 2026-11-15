# Building Taboom

How the source becomes a loadable extension, which command does what, and what the optional minified build buys you. Setup (Node 24, `npm install`, `just`) is in [LOCAL_DEV.md](LOCAL_DEV.md); how the build is wired is in [ARCHITECTURE.md](ARCHITECTURE.md#build-dev-loop-release); the test tiers are in [TESTING.md](TESTING.md).

Every command goes through [`just`](https://github.com/casey/just) — run `just --list` to see them all.

## Commands

| Command | What it does | When to use it |
|---|---|---|
| `just dev` | Builds `dist/dev-chrome` and rebuilds on every save (source maps on, blue DEV icons); runs `tsc --watch` alongside. The loaded extension reloads itself after each rebuild. | While developing — leave it running. |
| `just dev target=firefox` (alias `just dev-firefox`) | The same loop for the Firefox flavour: `dist/dev-firefox` with the Firefox manifest, its own reload port, so both loops run side by side. | Developing against Firefox — see [The dev loop](#the-dev-loop). |
| `just pack-firefox` | The Firefox build (`dist/firefox`) zipped to `dist/taboom-tabs-manager-v<version>-firefox.zip`. No gate; `just build` packs it too. | A Firefox zip to install as a temporary add-on or to upload to AMO. |
| `just firefox-lint`, `just firefox-run`, `just source-zip` | AMO's validator (`web-ext lint`) on the Firefox build; a throwaway Firefox profile running `dist/dev-firefox` as a temporary add-on, reloaded on every rebuild (`FIREFOX_BIN` picks the Firefox); the source archive AMO asks for next to a bundled add-on. | Firefox development and the AMO upload (`.private/publish/firefox-amo/`). |
| `npx vite build` | One production build into `dist/chrome` (`TARGET=firefox` → `dist/firefox`). No checks, no zip. | A quick look at what would ship. |
| `just check` | Biome lint + format check → strict `tsc` → unit and UI tests (all three feature-flag scenarios). About 12 s. | Before calling any change done. |
| `just test`, `just test-enabled`, `just test-experimental`, `just test-disabled`, `just test-watch` | The unit + UI tier, whole or one flag scenario, or re-running on save. | See [TESTING.md](TESTING.md). |
| `just test-browser` | Real-browser tier (headless Chromium). | Anything about focus, clicks, popovers, dialogs, drag & drop. |
| `just test-e2e` | Builds `dist/chrome`, then runs the Playwright tests against the real extension. | Anything that depends on what Chrome really does. |
| `just build` | The release gate: every check below, then `dist/taboom-tabs-manager-v<version>-chrome.zip` and `…-firefox.zip` (version from `package.json`). No recording: `docs/assets/demo/` and `docs/assets/features/` keep their files. | A packed build to test or to repack quickly. |
| `just build minify=true`, `just publish minify=true` | Same, minified output: `dist/taboom-tabs-manager-v<version>-chrome-min.zip` / `…-firefox-min.zip`. | Only if you want the smaller zip — see [Minified build](#minified-build). |
| `just publish` | `just build`, then the demo film, the feature stills and the README screenshots re-recorded against the packed build and copied into `docs/assets/` (about 5 minutes, needs ffmpeg). | Producing the store upload: a release ships with a current tour. |
| `just lint`, `just typecheck`, `just format` | The pieces of `check` on their own; `format` applies Biome's formatting and safe fixes. | |
| `just clean` | Removes `dist/`. | |
| `just demo-firefox`, `just demo-encode-firefox` | The demo in Firefox: the Firefox build in a real headless Firefox (WebDriver BiDi), the same scenes, into `dist/demo/<version>-firefox/`, films copied to `docs/assets/demo/firefox/`. | Checking the Firefox look, store screenshots for AMO. |
| `just test-perf-firefox`, `just perf-quick-firefox`, `just perf-at-firefox <ref>`, `just perf-refs-firefox` | The performance tier in Firefox — see [TESTING.md](TESTING.md#performance-tier). | Before a Firefox release. |
| `just demo` | Builds `dist/chrome`, records every demo scene against it in headless Chromium (a synthetic 10-window / 500-tab world) and encodes `dist/demo/<version>-chrome/taboom-<version>.mp4` (panel + story pane + Settings, every scene), `taboom-<version>-1080p.mp4` (the same film at 1920×1080, for YouTube, stays in `dist/`) and `.gif` (panel only, the short clips), copied to `docs/assets/demo/chrome/taboom-demo.mp4` / `.gif`, plus the feature stills and the README screenshots to `docs/assets/features/chrome/*.png`. About 5 minutes. `just demo scene=<id>` retakes one scene; `just demo-encode` re-encodes from the takes on disk; `just demo-stills [all|features|readme]` takes only the stills (feature stills, README screenshots, or both), no film. See [`demo/README.md`](../demo/README.md). | Release notes, README, store listing. |

The browser tiers need Playwright's browsers once: `npx playwright install chromium firefox`. The Firefox demo and perf tiers use the system Firefox (`/usr/bin/firefox`, or `FIREFOX_BIN=<path>`), Playwright's build as a fallback.

## What a build produces

```text
dist/dev-chrome/   development build — what you load unpacked while coding
dist/dev-firefox/  the same for Firefox (`just dev target=firefox`)
dist/chrome/       production build for Chrome — what gets zipped
dist/firefox/      the Firefox build (`TARGET=firefox`): the same files, the Firefox manifest
  manifest.json                   emitted from src/manifest.ts, version from package.json
  background/service-worker.js    the worker, at the fixed path the manifest points to
  sidepanel/index.html, index.js  the side panel page
  options/index.html, index.js    the options page
  chunks/*.js                     code shared between the worker and the pages
  assets/*.css, *.svg             page styles and images
  icons/                          from icons/prod
  features.json, CHANGES.md       copied from the repo root — the extension fetches them at run time
```

Output names are stable and unhashed on purpose: the manifest refers to files by path, and a readable, predictable file list is what `tests/structure/release-snapshot.test.ts` pins — for both flavours (`tests/fixtures/release-snapshot.json`, `release-snapshot-firefox.json`; the file lists must be identical, only the manifests differ). `dist/dev` additionally contains `dev-reload-client.js` and the blue `icons/dev/` — neither is ever part of `dist/prod`.

The build is configured in `vite.config.ts` (`TARGET=firefox` selects the Firefox manifest, output folder and esbuild target); the three small Vite plugins it uses live in `tooling/`. One source tree, one bundle, two manifests: the browser differences live behind `src/lib/platform/` and are feature-detected at run time, never read from a browser name; the only build-time difference inside the bundle is that the other browser's branch of the panel seam is compiled out (`__CHROME__` / `__FIREFOX__`, defined per target), so a store validator never reads code its browser cannot run ([ARCHITECTURE.md](ARCHITECTURE.md#generic-library-srclib)).

## The dev loop

`just dev`, then load `dist/dev-chrome` once (`chrome://extensions` → Developer mode → Load unpacked). After that every save rebuilds (tens of milliseconds) and the extension updates itself:

- a change to a page — TypeScript, HTML or CSS of the side panel or options — reloads the open extension pages;
- a change to the service worker, the manifest or code shared with the worker reloads the whole extension.

Type errors appear in the same terminal but never block the rebuild — Vite only strips types; `just check` is what enforces them. The reload signal reaches open extension pages only: if no side panel or options page is open when you change the worker, reload once by hand from `chrome://extensions`.

**Firefox.** `just dev target=firefox` (or `just dev-firefox`) builds `dist/dev-firefox` the same way, on its own reload port (5184; Chrome's loop uses 5183), so both loops run at once. Firefox has no persistent "load unpacked": either load `dist/dev-firefox/manifest.json` as a temporary add-on (`about:debugging` → This Firefox → Load Temporary Add-on — it is gone after a Firefox restart), or run `just firefox-run`, which starts a throwaway Firefox profile with the add-on through `web-ext` and reloads it on every file change. The dev-reload client works in Firefox too (the server answers with the CORS header Firefox requires of an extension page), so an open panel or Settings page reloads itself either way. The "DEV ·" marker and the blue badge come from the build mode, so `dist/dev-firefox` is marked and `dist/firefox` is not, however it is loaded.

## The release build

`just build` runs `scripts/build.sh` (`just publish` the same with `RECORD_DEMO=1`), which stops at the first failure:

1. `scripts/validate_versions.sh` — the version in `package.json` (the only place it lives) is newer than the latest `release-v*` git tag, and `CHANGES.md` has an entry for it.
2. `scripts/validate_hashes.sh` — every commit hash mentioned in `CHANGES.md` exists in git history.
3. `scripts/validate_code.sh` — `just check`.
4. `just test-browser`.
5. `scripts/pack.sh` — production build into `dist/chrome`, zipped to `dist/taboom-tabs-manager-v<version>-chrome.zip`; then `TARGET=firefox scripts/pack.sh` — the Firefox build into `dist/firefox`, zipped to `…-firefox.zip`, and `web-ext lint` on it (AMO's own validator).
6. `npx playwright test` — the e2e tests, against the `dist/chrome` that was just packed.
7. `node demo/record.ts` + `demo/encode.sh` — the feature demo, filmed against that same `dist/chrome` and copied to `docs/assets/demo/chrome/`, with the feature stills and the README screenshots (`readme-*`) to `docs/assets/features/chrome/` (about 5 minutes, needs ffmpeg). A scene that fails fails the release. Only `just publish` runs this step; `just build` stops after step 6 and keeps the previous recording.

Inside step 3, the test suite also pins what ships: the zip's file list and manifest, no dev or tooling files, no dev-loop or network code, no source maps.

To cut a release: bump `version` in `package.json`, write the `CHANGES.md` entry, run `just publish`, tag `release-v<version>`. The Firefox zip goes to addons.mozilla.org together with a source zip (`just source-zip`, AMO reviews bundled code against its source); the Firefox demo (`just demo-firefox`) is run on demand, not by `just publish`.

## Minified build

```bash
just build minify=true     # or: just build true
```

Same gate, same checks, but Vite minifies JavaScript and CSS and the zips are named `dist/taboom-tabs-manager-v<version>-chrome-min.zip` / `…-firefox-min.zip`. Without the gate: `MINIFY=1 scripts/pack.sh`. The default build — and the store upload — stays unminified.

What minifying changes (measured at v1.0.0):

| File | Readable | Minified |
|---|---|---|
| `sidepanel/index.js` | 95,578 bytes, 2,704 lines | 54,270 bytes, 3 lines |
| `background/service-worker.js` | 22,991 bytes | 12,568 bytes |
| `assets/sidepanel.css` | 24,094 bytes | 15,709 bytes |
| whole zip | 65,049 bytes | 51,218 bytes (`taboom-tabs-manager-v<version>-chrome-min.zip`) |

What it does not change is speed. Side panel start-up in real Chromium with 40 open tabs, from navigation to the first tab row on screen, 50 runs per build after warm-up:

| Build | Median | Fastest 10% | Slowest 10% |
|---|---|---|---|
| readable | 30.3 ms | 23.9 ms | 38.8 ms |
| minified | 28.6 ms | 23.9 ms | 38.4 ms |

The difference is inside the run-to-run noise. Nothing is downloaded — extension files sit on the local disk — and the minifier renames variables and drops whitespace without changing what the code does; start-up time goes into querying Chrome for tabs and building the DOM. So the trade is about 14 KB of zip against source a store reviewer can read and stack traces you can read. Size is not a problem for this extension, which is why readable is the default.

## When a build fails

| Message | Cause |
|---|---|
| `version … is not greater than previous release …` | `package.json` was not bumped since the last `release-v*` tag. |
| `CHANGES.md has no release notes entry for v…` | Add the `## v<version> — <date>` section. |
| `CHANGES.md references unknown commit: …` | A hash in the notes is not in git history (typo, or a rebased commit). |
| `shipped file list changed` / `shipped manifest changed` | The build now emits something different. If that is intended: `UPDATE_SNAPSHOT=1 npx vitest run tests/structure/release-snapshot.test.ts`, and review the diff of `tests/fixtures/release-snapshot.json`. |
| `The release zip (dist/chrome) contains "…"` | Dev-only or network code leaked into the production build. The message names the file and line, what the string means, and how to fix it. |
| `The release zip contains source maps: …` | `build.sourcemap` is on outside development mode — check `vite.config.ts`. |
| Playwright: `Executable doesn't exist` | `npx playwright install chromium`. |
| Vitest refuses to start / odd syntax errors | Wrong Node version — `nvm use` (the repo pins Node 24 in `.nvmrc`). |
