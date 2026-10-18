# demo/ — feature recordings

`just demo` builds the extension, boots it in headless Chromium, builds a synthetic world (10
named and colored windows, 500 tabs — pinned, snoozed, protected, grouped, tagged, duplicated,
one parked window, two keep-alive marks), plays every scene and encodes two files under
`dist/demo/<version>/`:

- `taboom-<version>.mp4` — 1440×868: the side panel (600 px wide) left; right, the story pane
  (scene title, the caption on screen, the captions already shown) over the real Settings page,
  scrolled to the section each scene is about. Every scene in registry order (≈ 3–4 minutes).
- `taboom-<version>.gif` — the panel alone, 480 px wide, the clips the scenes mark with `gif`
  (≤ 30 s).

Every encode also copies both to `docs/assets/demo/taboom-demo.mp4` / `.gif` (no version in
the name, so links stay put); `DEMO_PUBLISH=<dir>` sends the copies elsewhere, and an encode of
a `DEMO_DIR` scratch take copies nothing.

Nothing on screen is real: hosts end in `.test` and are served from a local HTTP server
(`fixture.ts` holds every title, window name and tag), the profile is a fresh temp directory,
and any other network request is refused and reported. Two runs of one commit produce the same
world (seeded).

## Feature stills

Scenes also take named screenshots where a feature is on screen — `stage.still("search-tag")`,
or `stage.still("settings-tags", "settings")` for the Settings pane (`"settings", 1180` shoots the
page from its top, that many px tall) — with the cursor and caption hidden.
The README's screenshots are the `readme-*` stills of the `readme` scene: the dark theme, stills
only, never filmed (`stillsOnly`); `just demo-stills readme` retakes them on their own. They land in `dist/demo/<version>/features/<name>.png` and every publishing encode
copies them to `docs/assets/features/`, where `docs/FEATURES.md` embeds every feature still and the
README every `readme-*` one (the stills test fails on a still a page does not show, or an
image no scene takes). Names are
fixed slugs, unique across scenes, at least one per scene (`tests/demo/stills.test.ts`); a
`--scene` retake refreshes only that scene's stills.

## Rerunning

`just publish` records and encodes as its last step, against the `dist/prod` it packed, so a
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

Takes live in `dist/demo/<version>/scenes/<id>/` (one JPEG per changed frame per stream,
`<stream>.txt` concat lists); `scenes.json` is the timeline `encode.sh` reads. A scene's own
checks (`stage.check`) land there as `warnings` and in the run's log — a recording with warnings
is a recording to look at.

## Files

| File | Role |
|---|---|
| `fixture.ts` | the synthetic world and the fake page HTML |
| `browser.ts` | headless Chromium with the built extension; builds the world through the worker; the fake-site server |
| `recorder.ts` | DevTools screencast per recorded page → frames + concat lists per scene and stream |
| `stage.ts` | the scene API: cursor and caption overlay, human-paced click / type / select, `settings()` to scroll the Settings pane, `still()` feature screenshots, checks |
| `story.ts` | the story pane (`http://story.test/`): title, current caption, captions already shown |
| `scenes/` | one module per scene; `index.ts` is the registry (order, `newIn`, `covers`, `gif`) |
| `record.ts` | the CLI: world → scenes → `scenes.json` |
| `encode.sh` | ffmpeg: per-stream clips, the panel + story + Settings composite, the GIF |

## Adding a scene

Export a `Scene` from a module in `scenes/`, add it to `SCENES` in `scenes/index.ts`. Every
scene names `settings: "#<id>"` — an id of `src/pages/options/index.html`; the Settings pane
scrolls to that card when the scene starts (`#page-title` for the top), and `stage.settings()`
jumps again mid-scene. Mark it `newIn: "<version>"` with a `covers` regex when it shows a
`### New Features` bullet of that release — `tests/demo/registry.test.ts` fails the build when
a bullet has no scene or an anchor is gone, so nothing new ships undemonstrated. Keep a scene
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
