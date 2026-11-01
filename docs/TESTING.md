# Testing Taboom - Tabs Manager

Four tiers, cheapest first. The first two run on every `just check`; the last two need a real browser and run on demand and in `just build`.

| Tier | Runs in | What belongs here | Command |
|---|---|---|---|
| **unit** | [Vitest](https://vitest.dev), plain Node | Pure logic: `src/app/*`, the page models, tooling, release packaging, changelog format | `just test` |
| **ui** | Vitest + [happy-dom](https://github.com/capricorn86/happy-dom) | DOM wiring of the real pages against a stubbed `chrome.*` — rendering, filters, menus, bulk actions | `just test` |
| **browser** | Vitest Browser Mode, headless Chromium | What happy-dom cannot judge: focus / blur order, which element a click lands on after a re-render, popover and `<dialog>` behaviour, drag & drop | `just test-browser` |
| **e2e** | [Playwright](https://playwright.dev), headless Chromium | The BUILT extension (`dist/prod`) in real Chrome. `smoke.spec.ts`: it loads, the service worker registers, side panel + options boot, zero network requests. `behaviour.spec.ts`: the few things only real Chrome can answer, because every other tier runs against a mock that behaves the way we *assume* Chrome does — a cross-window move really drops the pin (and the extension restores it), quick launch creates a real named tab group, protecting a site really sets `autoDiscardable`, settings persist and reach an open panel | `just test-e2e` |

Rule of thumb: put a test in the cheapest tier that can actually fail for the bug. Three shipped side-panel bugs were invisible to happy-dom (a synthetic Esc closing the popover, a click swallowed by a mid-press re-render, the click that commits an inline edit closing quick launch) — that is what the browser tier is for.

## Setup

1. [Node.js](https://nodejs.org/) 24 LTS — `.nvmrc` pins it (`nvm use`).
2. `npm install`
3. [`just`](https://github.com/casey/just) — the command runner ([installation guide](https://github.com/casey/just#installation)); `zip` / `unzip` for the release snapshot test.
4. Browser tiers only, once: `npx playwright install chromium`.

## Running

```bash
just check          # lint (Biome) + typecheck + unit + ui  (~12 s) — also the gate inside `just build`
just format         # apply Biome formatting + safe lint fixes
just test           # unit + ui
just test-watch     # rerun affected tests on save
just test-enabled        # one flag scenario: as shipped (+ the flag-independent unit tests)
just test-experimental   # … experimental flags on
just test-disabled       # … every flag off
just test-browser   # real-browser tier
just test-e2e       # build dist/prod, then the Playwright smoke
just typecheck      # tsc --noEmit (strict)
just test-perf      # performance tier, 2000 tabs (minutes) — see "Performance tier"
just perf-refs      # the last release tag vs HEAD, then the comparison
```

Single file / filtered run:

```bash
npx vitest run tests/app/core.test.ts
npx vitest run tests/pages/sidepanel        # a whole folder
npx vitest run -t "Service Worker"
```

## The feature-flag matrix

Every flag-dependent test runs three times, as three parallel Vitest projects (`vitest.config.ts`):

| Project | Meaning |
|---|---|
| `enabled` | flags exactly as shipped in `features.json` — `just test-enabled` |
| `experimental` | experimental flags treated as enabled (`ui.showExperimental` injected) — `just test-experimental` |
| `disabled` | every flag disabled — proves the UI survives a feature being off — `just test-disabled` |

Tests that do not depend on flags (tooling, release packaging, changelog format) run once, in the `unit` project. A test that only makes sense in one scenario skips itself with `{ skip: condition }`.

## Layout

`tests/` mirrors `src/`: a test lives where its subject lives. `*.ui.test.ts` = needs a DOM (happy-dom); everything else in these folders is plain Node.

| Folder | Covers |
|---|---|
| `tests/app/` | Pure domain logic in `src/app/`: `core`, `storage`, `window-identity`, `window-profiles`, `protection-rules`, `features` |
| `tests/lib/` | The generic library: `messaging`, `storage`, `platform/`, `ui/` (ask-dialog, inline-edit, context-menu, dropdown, toast) — hand-rolled fakes only, no Taboom imports |
| `tests/background/` | `service-worker.test.ts` — the worker driven by fired chrome events (alarms, messages, menus) |
| `tests/pages/` | `model.test.ts` (both pages' view models); `sidepanel/` mirrors the source subfolders — `model/` (`lookups`, `window-order`, `sort-direction`, `tab-hosts`), `dnd/` (`dnd-model`), `foundation/` (`state`, `elements`, `scheduler`) — with the `*.ui.test.ts` suites on the real page at its top; `options/` — `page-state`, `options.ui.test.ts` |
| `tests/tooling/` | `dev-reload.test.ts` — what a rebuild means for the loaded extension |
| `tests/structure/` | Repo-wide guards: `lib-boundary` (generic code imports nothing Taboom), `no-import-cycles`, `changes` (CHANGES.md format), `release-snapshot` — packs through the real `scripts/pack.sh` and pins WHAT SHIPS (zip file list + manifest, no dev/tooling files, no dev-loop or network code, no source maps). Intended change: `UPDATE_SNAPSHOT=1 npx vitest run tests/structure/release-snapshot.test.ts` |
| `tests/browser/` | Real-browser tier; `mount.ts` mounts the real side panel (HTML + CSS + entry module) in the test page |
| `tests/e2e/` | Playwright on the built extension: `smoke.spec.ts`, `behaviour.spec.ts`; `fixtures.ts` is a generic "one unpacked MV3 extension" fixture. Sites are faked with `context.route` on `*.test` hosts — no network. Keep this tier small (seconds, under ~10 tests): UI behaviour belongs in `tests/browser/` |
| `tests/helpers/` | `chrome-mock.ts` — the typed `chrome.*` stub (capturing events, flat call log), browser-safe, shared by the ui and browser tiers; `ui.ts` — happy-dom harness: `loadPage("src/pages/…/index.html")` (repo-root-relative), binds the mock to the current flag scenario |
| `tests/fixtures/` | `release-snapshot.json` |
| `tests/perf/` | The performance tier (`just test-perf`, see below): `run.ts` / `scenarios.ts` / `probes.ts` / `world.ts` are a tool, not tests; `stats.ts` is pure and `stats.test.ts` runs in `just check` |
| `tests/demo/` | `registry.test.ts` — the demo recorder's scene registry: unique ids, every `### New Features` bullet of the current `CHANGES.md` entry has a scene that covers it (exempt: a bullet saying "experimental" — experimental features are not filmed — and a feature the bundled Chromium cannot run yet, listed in `NOT_FILMABLE_YET` with the reason), the GIF clips fit the 30 s budget, every scene's Settings anchor is an id of the options page |

Which tests run per flag scenario and which run once is decided in `vitest.config.ts` (`FLAG_DEPENDENT` / `FLAG_INDEPENDENT`): `lib/`, `tooling/`, `structure/`, `demo/` and the pure page units run once; `app/`, `background/` and the rest of `pages/` run three times.

Not a test tier but built on the same Playwright setup: `demo/` records the feature demos (`just demo`, [`demo/README.md`](../demo/README.md)). It drives the built extension like `tests/e2e/` does and found two shipped bugs on its first run (a merged CSS selector, a Space keyup activating the quick launch row under a rename input) — when a scene looks wrong, suspect the extension before the scene.

## Performance tier

`just test-perf` builds `dist/prod`, launches it in headless Chromium through the demo's world builder with 2000 tabs (`just test-perf 1000 3` = 1000 tabs, 3 repetitions; `just perf-quick` = 500 tabs, 3 repetitions, a few minutes less), opens the side panel and Settings, and measures nine things, each `repeat` times (medians, p95, the raw samples; 15 by default — with five, the median of a scenario moved by half between two runs of the same commit):

| scenario | what is timed |
|---|---|
| `boot` | panel reload → first list row painted |
| `refresh` | a tab in another window navigates → the list has re-rendered (the 150 ms debounce included, as the user feels it) |
| `search` | typing a 4-letter query → the filtered list |
| `scroll` | p95 frame interval over five synthesized wheel gestures down the list (trusted input over the DevTools protocol) |
| `sort` | sort switch to the window grouping |
| `scope` | scope switch to the current window |
| `selectAll` | select all shown tabs → bulk bar, unselect |
| `settings` | Settings page reload → the rule tables painted |
| `worker` | a tab switch in another window → the worker's history write lands (worker clock) |

Every run writes `.private/perf/data/<version>-<stamp>-<label>.json` (commit — `+dirty` when `src` has uncommitted changes —, date, tab count, machine, repetitions, the summaries) and rebuilds `.private/perf/HISTORY.md` from every stored run: one line per run (dates in local time, the medians — smaller is better in every column), an `overall` verdict against the latest earlier run of the same tab count (the median of the per-scenario deltas in words: within 5 % "≈ same", else "N% faster" / "N% slower"), and the scenarios that moved by 10 % or more. `just perf-compare` prints the deltas between the two newest runs of the same tab count (or two files given) and the same overall verdict; a median more than 25 % above the older run is marked SLOWER. It is never a gate: numbers depend on the machine and its load, so compare runs of the same count on the same machine, and read a single SLOWER as a reason to look, not a verdict. The tier is not part of `just check` (minutes, not seconds); run it before a release.

```bash
just test-perf                    # this working tree: 2000 tabs, 15 repetitions → .private/perf/data/<version>-<stamp>-full.json
just test-perf 1000 3             # other size / repetitions
just perf-quick                   # 500 tabs, 3 repetitions
just perf-compare                 # deltas between the two newest runs of the same tab count
just perf-compare a.json b.json   # or two files
just perf-at release-v1.0.6       # one other commit, built in a throwaway worktree, measured with today's scenarios
just perf-refs                    # last release tag vs HEAD, back to back, then the comparison
just perf-refs dff3a8e            # a given previous hash vs HEAD
just perf-refs dff3a8e abc1234 1000 3
```

Two commits against each other: `just perf-refs` measures the last release tag and `HEAD` back to back and prints the comparison (`just perf-refs release-v1.0.7 HEAD 1000 3` for other refs, 1000 tabs, 3 repetitions); `just perf-at <ref>` does one of them. Each ref is built in a throwaway git worktree (`tests/perf/at-ref.sh`, this checkout's `node_modules` linked in) and measured with the CURRENT scenarios, so the two numbers are produced the same way; the run is labelled with the ref's short hash and its version comes from the built manifest.

## Conventions

- Test names are prefixed by group: `Core - `, `Core - Storage - `, `Service Worker - `, `UI - Sidepanel - `, `UI - Options - `, `Tooling - `, `Release Package - `; description capitalized.
- Assertions use `node:assert/strict`; Vitest's `expect` is fine in new tests (the browser tier uses it).
- Every test is strict TypeScript. DOM lookups go through `tests/helpers/dom.ts` — `q`, `qa`, `byId` throw a readable error when the node is missing; keep a plain nullable `querySelector` only where the test asserts ABSENCE.
- Each test file runs isolated, so page-script module state never leaks between files; tests **within** one file share the imported page and run in order — restore any fixture you change.
- ui tests import the real page script after `loadPage(...)` sets up DOM + chrome globals; interactions are plain DOM events. Browser-tier tests use `userEvent` from `vitest/browser` — trusted input, like a person.
- e2e: any tab event re-renders the list and a re-render closes an open context menu, so menu gestures go inside `expect(async () => { … }).toPass()`. A real `tabs.discard` currently segfaults Playwright's Chromium, so the snooze round trip is `test.fixme` (see the comment in `behaviour.spec.ts`).
- Chrome fires some listeners without awaiting them (e.g. `onAlarm`) — `await tick()` before asserting on their effects.
- `src/app/` stays `chrome.*`-free by design so it tests as plain functions.
- Never compare DOM nodes with `assert.equal` — a failure tries to print the whole node tree; compare a property or use `assert.ok(a === b)`.
