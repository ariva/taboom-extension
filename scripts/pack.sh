#!/usr/bin/env bash
# Build the production extension (dist/prod) and zip it — no gates; `just build` runs
# those first (scripts/build.sh). Also run by tests/structure/release-snapshot.test.ts, which pins
# the file list + manifest so a tooling change cannot silently change what ships.
# Usage: pack.sh [out.zip]   (default: dist/taboom-tabs-manager-v<version>.zip; MINIFY=1 → …-min.zip)
# <version> is package.json's — the same value the build stamps into manifest.json
set -euo pipefail
ROOT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_PATH"

VERSION="$(node -p "require('./package.json').version")"
DEFAULT_OUT="$ROOT_PATH/dist/taboom-tabs-manager-v$VERSION.zip"
if [ "${MINIFY:-}" = "1" ]; then
  DEFAULT_OUT="$ROOT_PATH/dist/taboom-tabs-manager-v$VERSION-min.zip"
fi
OUT="${1:-$DEFAULT_OUT}"

npx vite build --logLevel warn
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd dist/prod && zip -r -q "$OUT" .)
echo "$OUT ready"
