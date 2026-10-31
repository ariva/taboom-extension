#!/bin/sh
# Measure another commit with the CURRENT scenarios: build <ref> in a throwaway git worktree
# (node_modules linked from this checkout), run tests/perf/run.ts against that build, remove
# the worktree. The run is labelled with the ref's short hash.
#   tests/perf/at-ref.sh <ref> [tabs] [repeat]
set -eu
ref=$1
tabs=${2:-2000}
repeat=${3:-15}
hash=$(git rev-parse --short "$ref")
root=$(git rev-parse --show-toplevel)
dir=$(mktemp -d -t taboom-perf-XXXXXX)
cleanup() { git -C "$root" worktree remove --force "$dir" 2>/dev/null || rm -rf "$dir"; }
trap cleanup EXIT INT TERM
git -C "$root" worktree add -q --detach "$dir" "$ref"
if [ -f "$dir/vite.config.ts" ]; then
  ln -s "$root/node_modules" "$dir/node_modules" # the deps of this checkout; a ref with other deps needs its own install
  (cd "$dir" && npx --no-install vite build --logLevel warn)
  extension="$dir/dist/prod"
else
  extension="$dir" # before the Vite build (≤ 0.2.x): the checkout itself is the loadable extension
fi
node "$root/tests/perf/run.ts" --tabs "$tabs" --repeat "$repeat" --label "$hash" --extension "$extension" --commit "$hash"
