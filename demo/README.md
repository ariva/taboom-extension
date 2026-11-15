# demo/ — feature recordings

`just demo` builds the extension, boots it in headless Chromium, builds a synthetic world (10
named and colored windows, 500 tabs — pinned, snoozed, protected, grouped, tagged, duplicated,
one parked window, two keep-alive marks), plays every scene and encodes three files under
`dist/demo/<version>-chrome/`:

- `taboom-<version>.mp4` — 1440×940: the side panel (600 px wide) left; right, the story pane
  (scene title, the caption on screen, the captions already shown) over the real Settings page,
  scrolled to the section each scene is about. Every scene in registry order (≈ 3–4 minutes).
- `taboom-<version>-1080p.mp4` — the same film at 1920×1080 for YouTube: the canvas scaled to
  1080 px high (1654 wide), centred on the dark background.
- `taboom-<version>.gif` — the panel alone, 480 px wide, the clips the scenes mark with `gif`
  (≤ 30 s).

The pages are filmed at device scale 2 (`DEVICE_SCALE` in `demo/browser.ts`,
`--force-device-scale-factor`): every frame is twice the viewport, the scenes are composed at
2× and both films scaled down from there, so text stays sharp at 1080p. The pages themselves see
`devicePixelRatio` 1 (Playwright's viewport emulation), so layout and the stills are the 1:1
ones. Takes are about four times the size of 1:1 frames.

Every encode also copies the 1440×940 film and the GIF to `docs/assets/demo/chrome/taboom-demo.mp4` /
`.gif` (no version in the name, so links stay put; the 1080p film stays in `dist/`, too big for
the repo); `DEMO_PUBLISH=<dir>` sends the copies elsewhere, and an encode of a `DEMO_DIR`
scratch take copies nothing.

Nothing on screen is real: hosts end in `.test` and are served from a local HTTP server
(`fixture.ts` holds every title, window name and tag), the profile is a fresh temp directory,
and any other network request is refused and reported. Two runs of one commit produce the same
world (seeded).

## Feature stills

Captions are painted into a dark band below the panel (72 px, `CAPTION_BAND` in `demo/browser.ts`):
the panel page runs 600×892 with its body held at 820 px, so a caption never covers the UI, in the
film and in the GIF alike. Stills clip the band away.

Scenes also take named screenshots where a feature is on screen — `stage.still("search-tag")`,
or `stage.still("settings-tags", "settings")` for the Settings pane (`"settings", 1180` shoots the
page from its top, that many px tall) — with the cursor and caption hidden.
The README's screenshots are the `readme-*` stills of the `readme` scene: the dark theme, stills
only, never filmed (`stillsOnly`); `just demo-stills readme` retakes them on their own. They land in `dist/demo/<version>-chrome/features/<name>.png` and every publishing encode
copies them to `docs/assets/features/chrome/`, where `docs/FEATURES.md` embeds every feature still and the
README every `readme-*` one (the stills test fails on a still a page does not show, or an
image no scene takes). Names are
fixed slugs, unique across scenes, at least one per scene (`tests/demo/stills.test.ts`); a
`--scene` retake refreshes only that scene's stills.

## Firefox

`just demo-firefox` films the same scenes in a real headless **Firefox** with the Firefox build (`dist/firefox`), into `dist/demo/<version>-firefox/`, and copies the films to `docs/assets/demo/firefox/taboom-demo.mp4` / `.gif` (the Chrome films and the stills the docs embed stay where they are; a Firefox take publishes no stills). `just demo-firefox scene=search` retakes one scene, `just demo-encode-firefox` re-encodes from the takes.

Playwright cannot load an extension into Firefox, so `demo/firefox/` speaks WebDriver BiDi to Firefox itself: a fresh profile whose prefs pin the extension's internal UUID (a known `moz-extension://` origin), send every request through a PAC proxy to the fake-site server (anything outside `*.test` is refused and reported, like Chromium's route) and render at device scale 2 (`layout.css.devPixelsPerPx` — BiDi cannot emulate a scale on an extension page); `webExtension.install` loads the built add-on; BiDi navigates the first tab to the panel page (`MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` allows the `moz-extension://` navigation), but that tab only bootstraps: a tab navigated that way never gets the focus in headless Firefox, and without window focus no focus/blur events fire — the inline edits (rename, new group) commit on blur. So the bootstrap page has the extension open the real panel into a popup window of its own (a window the extension opens does take the focus; `windows.update` brings it back after the world's windows and the asides — Firefox ignores `focused: false` on `windows.create`), the bootstrap window is closed, and that panel page doubles as the "worker" the world builder talks to — an extension page has the same `chrome.*`. Pages are sized through their windows (`chrome.windows.update` until the inner size matches; BiDi's viewport emulation refuses extension pages), input goes through `input.performActions` (a locator waits for a stable box like Playwright does — a click into a smooth-scrolling Settings pane would land elsewhere), and the recorder polls `browsingContext.captureScreenshot` every 120 ms per stream, keeping changed frames only — BiDi has no screencast. The system Firefox is used (`FIREFOX_BIN` overrides), Playwright's as a fallback.

## Rerunning

`just publish` records and encodes as its last step, against the `dist/chrome` it packed, so a
release always ships with a current tour; a plain `just build` stops at the zip and keeps the
previous film and screenshots.

```bash
just demo                 # everything: build, record, encode
just demo scene=search    # retake one scene (fresh world), leave the other takes, re-encode
just demo-stills          # every still, no film: the feature stills and the README screenshots
just demo-stills readme   # the README screenshots only; `features` for the feature stills only
just demo-encode          # ffmpeg only, from the takes on disk
node demo/record.ts --scene tags --scene parked   # several scenes, no encode
DEMO_FILLER=5 node demo/record.ts --scene search  # a small world (5 tabs per filler window) while tuning a scene
DEMO_DIR=/tmp/take/1.0.5 ./demo/encode.sh          # encode a take recorded with --out /tmp/take
```

A `--scene` retake starts a fresh story pane: its "done" list holds only that scene's captions,
not the ones of the scenes before it in the full film.

Takes live in `dist/demo/<version>-chrome/scenes/<id>/` (`-firefox` for the Firefox take) (one JPEG per changed frame per stream,
`<stream>.txt` concat lists); `scenes.json` is the timeline `encode.sh` reads. A scene's own
checks (`stage.check`) land there as `warnings` and in the run's log — a recording with warnings
is a recording to look at.

## Files

| File | Role |
|---|---|
| `fixture.ts` | the synthetic world and the fake page HTML |
| `page-api.ts` | the interfaces everything is written against: `DemoPage`, `DemoLocator`, `Evaluator`, `DemoBrowser`, `FrameRecorder` |
| `browser.ts` | `launch(…, browser)`: headless Chromium with the built extension (Playwright) or Firefox (`firefox/`); the fake-site server both use; the viewport constants |
| `playwright-page.ts` | Playwright's Page / Locator behind the interfaces |
| `world.ts` | builds the world through the extension's own `chrome.*` (the worker on Chromium, the panel page on Firefox) |
| `recorder.ts` | Chromium: DevTools screencast per recorded page → frames + concat lists per scene and stream |
| `firefox/protocol.ts`, `firefox/page.ts`, `firefox/browser.ts`, `firefox/recorder.ts` | Firefox over WebDriver BiDi: the client and value encoding, a page/locator that resolves selectors in the page and types through `input.performActions`, the profile + install + panel tab, screenshot polling |
| `stage.ts` | the scene API: cursor and caption overlay, human-paced click / type / select, `settings()` to scroll the Settings pane, `still()` feature screenshots, checks |
| `story.ts` | the story pane (`http://story.test/`): title, current caption, captions already shown |
| `scenes/` | one module per scene; `index.ts` is the registry (order, `newIn`, `covers`, `gif`) |
| `record.ts` | the CLI: world → scenes → `scenes.json` (`--browser firefox` for the Firefox take) |
| `encode.sh` | ffmpeg: per-stream clips, the panel + story + Settings composite at 2×, the 1440×940 and 1080p films, the GIF |

## Adding a scene

Export a `Scene` from a module in `scenes/`, add it to `SCENES` in `scenes/index.ts`. Every
scene names `settings: "#<id>"` — an id of `src/pages/options/index.html`; the Settings pane
scrolls to that card when the scene starts (`#page-title` for the top), and `stage.settings()`
jumps again mid-scene. Mark it `newIn: "<version>"` with a `covers` regex when it shows a
`### New Features` bullet of that release — `tests/demo/registry.test.ts` fails the build when
a bullet has no scene or an anchor is gone, so nothing new ships undemonstrated. Two
exceptions: a bullet that says "experimental" (a feature behind **Show experimental features**)
is not filmed and needs no scene — the film shows what every user gets; and a feature the
bundled Chromium cannot run yet (split view needs Chrome 155+) is listed in the test's
`NOT_FILMABLE_YET` with the reason, until that Chromium catches up. Keep a scene
under ~25 s; `gif: [from, to]` picks its GIF clip.

## Why it looks the way it does

- The real side panel cannot be captured (it is browser chrome, and opening it needs a user
  gesture); the panel page runs in a tab at 600×820, as `tests/e2e/` does — wide enough for a
  row's tags to stay on one line. The story pane and the Settings page are popup windows of
  their own; the overlay hides their rows from the panel.
- Playwright's default Chromium flags make Chromium 153 crash on `chrome.tabs.discard`; the
  launch drops them (`ignoreDefaultArgs: true`) and passes the few that matter by hand.
- Fake pages come from a local server through `--host-resolver-rules` and
  `--testing-fixed-http-port`, not from route interception: 500 tabs fire their first request
  before interception attaches.
- Native `confirm()` dialogs are accepted (Playwright dismisses them by default).
- Headless Chromium paints no `<select>` dropdown: `stage.select()` / `stage.settingsSelect()`
  draw the options as a list, mark the current value, then the chosen one, and only then change
  the value — a value flipping on its own read as a cut.
