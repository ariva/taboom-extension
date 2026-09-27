#!/usr/bin/env bash
# Version gate:
#   1. version (package.json — the single source; the build stamps it into manifest.json)
#      is greater than the latest release-v* tag
#   2. CHANGES.md has an entry for this version
set -euo pipefail
ROOT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_PATH"

manifest_version=$(jq -r .version package.json)

# "previous release" excludes the current version's own tag — building an
# already-tagged release (tag first, then pack) must not trip the check
latest_tag=$(git tag --sort=-v:refname | grep -v "^release-v${manifest_version}$" | head -1)
previous_version=${latest_tag#release-v}
if [ -n "$previous_version" ]; then
  # highest by version-sort must be the new one, and it must not equal the old
  highest=$(printf '%s\n%s\n' "$previous_version" "$manifest_version" | sort -V | tail -1)
  if [ "$manifest_version" = "$previous_version" ] || [ "$highest" != "$manifest_version" ]; then
    echo "version ${manifest_version} is not greater than previous release ${previous_version}" >&2
    exit 1
  fi
fi

if ! grep -q "^## v${manifest_version} " CHANGES.md; then
  echo "CHANGES.md has no release notes entry for v${manifest_version}" >&2
  exit 1
fi

echo "validate_versions: v${manifest_version} OK (previous ${previous_version:-none})"
