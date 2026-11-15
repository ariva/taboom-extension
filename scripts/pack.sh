#!/usr/bin/env bash
# Build the production extension for one browser (dist/chrome, or dist/firefox with TARGET=firefox)
# and zip it — no gates; `just build` runs those first (scripts/build.sh). Also run by
# tests/structure/release-snapshot.test.ts, which pins the file list + manifest so a tooling change
# cannot silently change what ships.
# Usage: [TARGET=firefox] [MINIFY=1] pack.sh [out.zip]
#   default: dist/taboom-tabs-manager-v<version>-<target>.zip, MINIFY=1 → …-<target>-min.zip
# <version> is package.json's — the same value the build stamps into manifest.json
set -euo pipefail
ROOT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_PATH"

VERSION="$(node -p "require('./package.json').version")"
BROWSER="${TARGET:-chrome}"
BUILD_DIR="dist/$BROWSER"
SUFFIX="-$BROWSER"
if [ "${MINIFY:-}" = "1" ]; then
  SUFFIX="$SUFFIX-min"
fi
OUT="${1:-$ROOT_PATH/dist/taboom-tabs-manager-v$VERSION$SUFFIX.zip}"

npx vite build --logLevel warn
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$BUILD_DIR" && zip -r -q "$OUT" .)
echo "$OUT ready"
