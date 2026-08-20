#!/usr/bin/env bash
# Release-gate + pack. Run via `just build`.
# Validates before zipping:
#   - lint + typecheck + tests (scripts/validate_code.sh → just check)
#   - versions match, > previous release, notes entry exists (scripts/validate_versions.sh)
#   - every hash in CHANGES.md exists in git history (scripts/validate_hashes.sh)
set -euo pipefail
ROOT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_PATH"

"$ROOT_PATH/scripts/validate_versions.sh"
"$ROOT_PATH/scripts/validate_hashes.sh"
"$ROOT_PATH/scripts/validate_code.sh"

mkdir -p dist
rm -f dist/taboom-tabs-manager.zip
zip -r dist/taboom-tabs-manager.zip manifest.json CHANGES.md features.json \
  background core sidepanel options icons styles images/moon.svg
echo "dist/taboom-tabs-manager.zip ready"
