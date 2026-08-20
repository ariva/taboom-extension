#!/usr/bin/env bash
# Version gate:
#   1. package.json version == manifest.json version
#   2. version is greater than the latest release-v* tag
#   3. CHANGES.md has an entry for this version
set -euo pipefail
ROOT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_PATH"

manifest_version=$(jq -r .version manifest.json)
package_version=$(jq -r .version package.json)

if [ "$manifest_version" != "$package_version" ]; then
  echo "version mismatch: manifest.json=${manifest_version} package.json=${package_version}" >&2
  exit 1
fi

latest_tag=$(git tag --sort=-v:refname | head -1)
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
