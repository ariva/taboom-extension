# TabsManager — vanilla JS MV3 extension, no compile step.
# `just build` packs a zip; loading unpacked needs no build at all.

set shell := ["bash", "-uc"]

default: check

# lint + test
check: lint test

# syntax-check every JS file (node parses ES modules via package.json type:module)
lint:
    fd -e js -E node_modules . | xargs -I{} node --check {}
    node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))" && echo "manifest.json OK"

# unit tests for pure core logic
test:
    node --test tests/*.test.js

# pack distributable zip (excludes docs/tests/tooling)
build: check
    mkdir -p dist
    rm -f dist/tabs-manager.zip
    zip -r dist/tabs-manager.zip manifest.json background core sidepanel popup options icons styles
    @echo "dist/tabs-manager.zip ready"

clean:
    rm -rf dist
