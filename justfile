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

# three passes: flags as shipped; experimental flags treated as enabled;
# every flag disabled (helpers/ui.js wires each scenario into the code under test)
test: test-enabled test-experimental test-disabled

# flags exactly as shipped in features.json
test-enabled:
    node --test tests/*.test.js

# experimental flags treated as enabled (ui.showExperimental injected)
test-experimental:
    TEST_EXPERIMENTAL=1 node --test tests/*.test.js

# every feature flag disabled
test-disabled:
    TEST_ALL_DISABLED=1 node --test tests/*.test.js

# release-gate (code checks, versions match, > previous tag, notes + valid hashes) then pack
build:
    ./scripts/build.sh

clean:
    rm -rf dist
