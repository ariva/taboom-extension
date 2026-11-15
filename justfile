# Taboom - Tabs Manager — MV3 extension built with Vite (see vite.config.ts).
# `just dev` builds dist/dev-chrome and keeps it fresh — load THAT folder unpacked in Chrome.
# `just build` runs the release gate and packs dist/chrome (and dist/firefox) into zips.

set shell := ["bash", "-uc"]

default: check

# lint + typecheck + test
check: lint typecheck test

# Enforces braces on every `if` and that src/lib + tooling import nothing Taboom-specific.
# Biome: lint + format check in one pass (biome.json)
lint:
    npx biome check

# apply formatting and safe lint fixes
format:
    npx biome check --write

# strict type check, no emit — Vite transpiles without checking, so this is the gate
typecheck:
    npx tsc -p tsconfig.json

# the three flag scenarios below + the flag-independent unit tests, as parallel Vitest projects (vitest.config.ts)
test:
    npx vitest run

# flags exactly as shipped in features.json (+ the flag-independent unit tests)
test-enabled:
    npx vitest run --project unit --project enabled

# experimental flags treated as enabled (ui.showExperimental injected)
test-experimental:
    npx vitest run --project experimental

# every feature flag disabled
test-disabled:
    npx vitest run --project disabled

# flags as shipped against the Firefox-shaped chrome mock (no sidePanel / onReplaced / split view / favicon store)
test-firefox:
    npx vitest run --project firefox

# rerun affected tests on save
test-watch:
    npx vitest

# real-browser tier (Vitest Browser Mode, headless Chromium): focus, clicks, popovers, dialogs
test-browser:
    npx vitest run -c vitest.browser.config.ts

# end-to-end smoke: production build loaded into real headless Chromium (Playwright)
test-e2e:
    npx vite build --logLevel warn
    npx playwright test

# Performance tier (docs/TESTING.md "Performance tier"): the production build in headless Chromium
# with a synthetic world, nine measurements, medians of `repeat` runs → .private/perf/data/<version>-<stamp>-<label>.json
# and .private/perf/HISTORY.md + COMPARISONS.md rebuilt from every run. Not a gate; run before a release, compare on the same machine.
test-perf tabs="2000" repeat="15":
    npx vite build --logLevel warn
    node tests/perf/run.ts --tabs {{ tabs }} --repeat {{ repeat }} --label full

# the quick version: 500 tabs, 3 repetitions (a few minutes less; compare only with other quick runs)
perf-quick:
    npx vite build --logLevel warn
    node tests/perf/run.ts --tabs 500 --repeat 3 --label quick

# deltas between two runs (default: the two newest of the same tab count); > +25 % is marked SLOWER
perf-compare older="" newer="":
    node tests/perf/compare.ts {{ older }} {{ newer }}

# measure another commit with today's scenarios: built in a throwaway worktree, labelled with its hash
perf-at ref="HEAD" tabs="2000" repeat="15":
    tests/perf/at-ref.sh {{ ref }} {{ tabs }} {{ repeat }}

# two commits back to back, then the comparison — base defaults to the last release tag
perf-refs base="" head="HEAD" tabs="2000" repeat="15":
    tests/perf/at-ref.sh {{ if base == "" { "$(git describe --tags --abbrev=0)" } else { base } }} {{ tabs }} {{ repeat }}
    tests/perf/at-ref.sh {{ head }} {{ tabs }} {{ repeat }}
    node tests/perf/compare.ts

# The same tier in Firefox (T-0152): the Firefox build (dist/firefox) in a real headless Firefox driven over
# WebDriver BiDi, the same nine scenarios; runs are marked `firefox` and judged only against Firefox runs
test-perf-firefox tabs="2000" repeat="15":
    TARGET=firefox npx vite build --logLevel warn
    node tests/perf/run.ts --tabs {{ tabs }} --repeat {{ repeat }} --label full --browser firefox

perf-quick-firefox:
    TARGET=firefox npx vite build --logLevel warn
    node tests/perf/run.ts --tabs 500 --repeat 3 --label quick --browser firefox

perf-at-firefox ref="HEAD" tabs="2000" repeat="15":
    BROWSER=firefox tests/perf/at-ref.sh {{ ref }} {{ tabs }} {{ repeat }}

perf-refs-firefox base="" head="HEAD" tabs="2000" repeat="15":
    BROWSER=firefox tests/perf/at-ref.sh {{ if base == "" { "$(git describe --tags --abbrev=0)" } else { base } }} {{ tabs }} {{ repeat }}
    BROWSER=firefox tests/perf/at-ref.sh {{ head }} {{ tabs }} {{ repeat }}
    node tests/perf/compare.ts

# First time: chrome://extensions → Load unpacked → dist/dev-chrome. The loaded extension then
# reloads itself after each rebuild (tooling/dev-reload-plugin.ts); type errors stream alongside.
# development loop: rebuild dist/dev-chrome on every save (source maps, dev icons) + tsc --watch.
# `just dev target=firefox` (or `just dev firefox`) builds dist/dev-firefox (the Firefox manifest)
# on its own reload port, so both loops run side by side; Firefox loads it as a temporary add-on
# (about:debugging) or through `just firefox-run` (docs/BUILD.md "The dev loop"). just hands
# `target=firefox` to the recipe as a literal argument, hence the regex (as `build minify=true`)
dev target="chrome":
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT
    export TARGET={{ if target =~ '^(target=)?firefox$' { "firefox" } else { "chrome" } }}
    npx tsc -p tsconfig.json --watch --preserveWatchOutput &
    npx vite build --watch --mode development

# alias: `just dev target=firefox`
dev-firefox:
    just dev target=firefox

# the Firefox build (dist/firefox) zipped to dist/taboom-tabs-manager-v<version>-firefox.zip — no gate
pack-firefox:
    TARGET=firefox ./scripts/pack.sh

# the source archive addons.mozilla.org asks for next to a bundled add-on: the committed tree at HEAD
source-zip:
    ./scripts/source-zip.sh

# AMO's validator on the Firefox build (web-ext); `just build` runs it too
firefox-lint:
    TARGET=firefox npx vite build --logLevel warn
    npx --no-install web-ext lint --source-dir dist/firefox --no-config-discovery

# a throwaway Firefox profile with dist/dev-firefox as a temporary add-on, reloaded on every rebuild —
# run `just dev-firefox` alongside (docs/BUILD.md "The dev loop"). FIREFOX_BIN picks another Firefox
firefox-run:
    npx --no-install web-ext run --source-dir dist/dev-firefox --no-config-discovery {{ if env("FIREFOX_BIN", "") != "" { "--firefox " + env("FIREFOX_BIN") } else { "" } }}

# `just build minify=true` (or `just build true`) packs a minified copy instead (…-min.zip); the
# store upload stays readable. just hands `minify=true` to the recipe as a literal argument, hence
# the regex. Details and measurements: docs/BUILD.md
# release gate (version, notes, hashes, check, browser tier) → pack dist/chrome + dist/firefox → e2e on the packed
# build. No recording: docs/assets/demo/chrome/ and docs/assets/features/chrome/ stay as they are
build minify="false":
    MINIFY={{ if minify =~ '^(minify=)?true$' { "1" } else { "" } }} ./scripts/build.sh

# the same gate and zip, then the demo film, the feature stills and the README screenshots
# re-recorded against the packed build (~5 min, needs ffmpeg) — what a release ships with
publish minify="false":
    MINIFY={{ if minify =~ '^(minify=)?true$' { "1" } else { "" } }} RECORD_DEMO=1 ./scripts/build.sh

# remove dist/
clean:
    rm -rf dist

# Feature demo recordings (demo/README.md): a synthetic 10-window / 500-tab world in headless
# Chromium, scenes filmed per window, ffmpeg composes dist/demo/<version>-chrome/taboom-<version>.mp4
# (panel + story pane + Settings, every scene), taboom-<version>-1080p.mp4 (the same at 1920×1080)
# and .gif (panel only, the short clips).
# record every scene and encode both files — `just demo scene=search` retakes one scene
demo scene="":
    npx vite build --logLevel warn
    node demo/record.ts {{ if scene != "" { "--scene " + scene } else { "" } }}
    ./demo/encode.sh

# re-encode the MP4s and GIF from the takes on disk (no browser)
demo-encode:
    ./demo/encode.sh

# The demo in Firefox (T-0152): the Firefox build in a real headless Firefox (WebDriver BiDi), the same
# scenes, filmed by screenshot polling into dist/demo/<version>-firefox/ and published to
# docs/assets/demo/firefox/ (the Chrome films live in docs/assets/demo/chrome/, the stills in docs/assets/features/chrome/)
demo-firefox scene="":
    TARGET=firefox npx vite build --logLevel warn
    node demo/record.ts --browser firefox {{ if scene != "" { "--scene " + scene } else { "" } }}
    DEMO_DIR=dist/demo/$(node -p "require('./package.json').version")-firefox DEMO_PUBLISH=docs/assets/demo/firefox ./demo/encode.sh

demo-encode-firefox:
    DEMO_DIR=dist/demo/$(node -p "require('./package.json').version")-firefox DEMO_PUBLISH=docs/assets/demo/firefox ./demo/encode.sh

# only the stills, no film, no ffmpeg: `all` (default) = the feature stills of every scene and
# the README screenshots, `features` or `readme` = one of the two, published to docs/assets/features/chrome/
demo-stills what="all":
    npx vite build --logLevel warn
    node demo/record.ts --stills {{ what }}
    ./demo/encode.sh --stills
