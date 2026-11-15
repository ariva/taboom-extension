#!/usr/bin/env bash
# The source archive addons.mozilla.org asks for when an add-on ships bundled code (ours is
# Vite output): the committed tree at HEAD — .private/ is gitignored and never part of it —
# plus a pointer to the build instructions. Usage: scripts/source-zip.sh [out.zip]
set -euo pipefail
ROOT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_PATH"
VERSION="$(node -p "require('./package.json').version")"
OUT="${1:-$ROOT_PATH/dist/taboom-tabs-manager-v$VERSION-source.zip}"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
git archive --format=zip --prefix="taboom-$VERSION/" -o "$OUT" HEAD
echo "$OUT ready — build with: nvm use && npm ci && TARGET=firefox npx vite build (docs/BUILD.md)"
