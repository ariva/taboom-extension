# Building Taboom

How the source becomes a loadable extension, which command does what, and what the optional minified build buys you. Setup (Node 24, `npm install`, `just`) is in [INSTALL.md](INSTALL.md); how the build is wired is in [ARCHITECTURE.md](ARCHITECTURE.md#build-dev-loop-release); the test tiers are in [TESTING.md](TESTING.md).

Every command goes through [`just`](https://github.com/casey/just) — run `just --list` to see them all.

## Commands

| Command | What it does | When to use it |
|---|---|---|
| `just dev` | Builds `dist/dev` and rebuilds on every save (source maps on, blue DEV icons); runs `tsc --watch` alongside. The loaded extension reloads itself after each rebuild. | While developing — leave it running. |
| `npx vite build` | One production build into `dist/prod`. No checks, no zip. | A quick look at what would ship. |
| `just check` | Biome lint + format check → strict `tsc` → unit and UI tests (all three feature-flag scenarios). About 12 s. | Before calling any change done. |
| `just test`, `just test-enabled`, `just test-experimental`, `just test-disabled`, `just test-watch` | The unit + UI tier, whole or one flag scenario, or re-running on save. | See [TESTING.md](TESTING.md). |
| `just test-browser` | Real-browser tier (headless Chromium). | Anything about focus, clicks, popovers, dialogs, drag & drop. |
| `just test-e2e` | Builds `dist/prod`, then runs the Playwright tests against the real extension. | Anything that depends on what Chrome really does. |
| `just build` | The release: every check below, then `dist/taboom-tabs-manager-v<version>.zip` (version from `package.json`). | Producing the store upload. |
| `just build minify=true` | Same release gate, minified output: `dist/taboom-tabs-manager-v<version>-min.zip`. | Only if you want the smaller zip — see [Minified build](#minified-build). |
| `just lint`, `just typecheck`, `just format` | The pieces of `check` on their own; `format` applies Biome's formatting and safe fixes. | |
| `just clean` | Removes `dist/`. | |

The browser tiers need Playwright's Chromium once: `npx playwright install chromium`.

## What a build produces

```text
dist/dev/     development build — what you load unpacked while coding
dist/prod/    production build — what gets zipped
  manifest.json                   emitted from src/manifest.ts, version from package.json
  background/service-worker.js    the worker, at the fixed path the manifest points to
  sidepanel/index.html, index.js  the side panel page
  options/index.html, index.js    the options page
  chunks/*.js                     code shared between the worker and the pages
  assets/*.css, *.svg             page styles and images
  icons/                          from icons/prod
  features.json, CHANGES.md       copied from the repo root — the extension fetches them at run time
```

Output names are stable and unhashed on purpose: the manifest refers to files by path, and a readable, predictable file list is what `tests/structure/release-snapshot.test.ts` pins. `dist/dev` additionally contains `dev-reload-client.js` and the blue `icons/dev/` — neither is ever part of `dist/prod`.

The build is configured in `vite.config.ts`; the three small Vite plugins it uses live in `tooling/`.

## The dev loop

`just dev`, then load `dist/dev` once (`chrome://extensions` → Developer mode → Load unpacked). After that every save rebuilds (tens of milliseconds) and the extension updates itself:

- a change to a page — TypeScript, HTML or CSS of the side panel or options — reloads the open extension pages;
- a change to the service worker, the manifest or code shared with the worker reloads the whole extension.

Type errors appear in the same terminal but never block the rebuild — Vite only strips types; `just check` is what enforces them. The reload signal reaches open extension pages only: if no side panel or options page is open when you change the worker, reload once by hand from `chrome://extensions`.

## The release build

`just build` runs `scripts/build.sh`, which stops at the first failure:

1. `scripts/validate_versions.sh` — the version in `package.json` (the only place it lives) is newer than the latest `release-v*` git tag, and `CHANGES.md` has an entry for it.
2. `scripts/validate_hashes.sh` — every commit hash mentioned in `CHANGES.md` exists in git history.
3. `scripts/validate_code.sh` — `just check`.
4. `just test-browser`.
5. `scripts/pack.sh` — production build into `dist/prod`, zipped to `dist/taboom-tabs-manager-v<version>.zip`.
6. `npx playwright test` — the e2e tests, against the `dist/prod` that was just packed.

Inside step 3, the test suite also pins what ships: the zip's file list and manifest, no dev or tooling files, no dev-loop or network code, no source maps.

To cut a release: bump `version` in `package.json`, write the `CHANGES.md` entry, run `just build`, tag `release-v<version>`.

## Minified build

```bash
just build minify=true     # or: just build true
```

Same gate, same checks, but Vite minifies JavaScript and CSS and the zip is named `dist/taboom-tabs-manager-v<version>-min.zip`. Without the gate: `MINIFY=1 scripts/pack.sh`. The default build — and the store upload — stays unminified.

What minifying changes (measured at v1.0.0):

| File | Readable | Minified |
|---|---|---|
| `sidepanel/index.js` | 95,578 bytes, 2,704 lines | 54,270 bytes, 3 lines |
| `background/service-worker.js` | 22,991 bytes | 12,568 bytes |
| `assets/sidepanel.css` | 24,094 bytes | 15,709 bytes |
| whole zip | 65,049 bytes | 51,218 bytes (`taboom-tabs-manager-v<version>-min.zip`) |

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
| `The release zip (dist/prod) contains "…"` | Dev-only or network code leaked into the production build. The message names the file and line, what the string means, and how to fix it. |
| `The release zip contains source maps: …` | `build.sourcemap` is on outside development mode — check `vite.config.ts`. |
| Playwright: `Executable doesn't exist` | `npx playwright install chromium`. |
| Vitest refuses to start / odd syntax errors | Wrong Node version — `nvm use` (the repo pins Node 24 in `.nvmrc`). |
