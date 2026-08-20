#!/usr/bin/env bash
# Validate that every commit hash referenced in CHANGES.md exists in git
# history. Hashes go stale when history if rewritten —
# this catches release notes pointing at commits that no longer exist.
# Also validates integrity of commit hashes in CHANGES.md
set -euo pipefail
ROOT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_PATH"

missing=0
checked=0
while read -r hash; do
  checked=$((checked + 1))
  if ! git cat-file -e "${hash}^{commit}" 2>/dev/null; then
    echo "CHANGES.md references unknown commit: ${hash}" >&2
    missing=$((missing + 1))
  fi
done < <(grep -oE '\([0-9a-f]{7,40}\)$' CHANGES.md | tr -d '()')

if [ "$missing" -gt 0 ]; then
  echo "validate_hashes: ${missing}/${checked} hashes not found in history" >&2
  exit 1
fi
echo "validate_hashes: ${checked} hashes OK"
