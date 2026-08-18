# Taboom - Tabs Manager — vanilla JS MV3 extension, no compile step.
# `just build` packs a zip; loading unpacked needs no build at all.

set shell := ["bash", "-uc"]

default: check

# lint + typecheck + test
check: lint typecheck test

# syntax-check every JS file (node parses ES modules via package.json type:module)
lint:
    fd -e js -E node_modules . | xargs -I{} node --check {}
    node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))" && echo "manifest.json OK"

# JSDoc type check via tsc — no emit, files ship as written (jsconfig.json)
typecheck:
    npx tsc -p jsconfig.json

# unit tests for pure core logic
test:
    node --test tests/*.test.js

# pack distributable zip (excludes docs/tests/tooling)
build: check
    mkdir -p dist
    rm -f dist/taboom-tabs-manager.zip
    zip -r dist/taboom-tabs-manager.zip manifest.json CHANGES.md features.json background core sidepanel options icons styles images/moon.svg
    @echo "dist/taboom-tabs-manager.zip ready"

clean:
    rm -rf dist
