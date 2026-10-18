#!/usr/bin/env bash
# Release-gate + pack. Run via `just build`.
# Validates before zipping:
#   - lint + typecheck + unit/ui tests (scripts/validate_code.sh → just check)
#   - real-browser tier before packing, e2e smoke against the packed build after
#   - versions match, > previous release, notes entry exists (scripts/validate_versions.sh)
#   - every hash in CHANGES.md exists in git history (scripts/validate_hashes.sh)
#   - with RECORD_DEMO=1 (`just publish`) the feature demo and every screenshot are re-recorded
#     against the packed build (demo/README.md) so the README tour never lags a release;
#     a plain `just build` stops at the zip (quick repack, no ffmpeg)
set -euo pipefail
ROOT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_PATH"

"$ROOT_PATH/scripts/validate_versions.sh"
"$ROOT_PATH/scripts/validate_hashes.sh"
"$ROOT_PATH/scripts/validate_code.sh"
just test-browser # real-Chromium tier: focus, clicks, popovers, dialogs, drag & drop

"$ROOT_PATH/scripts/pack.sh"
npx playwright test # e2e smoke against the dist/prod that was just packed

if [ "${RECORD_DEMO:-}" = "1" ]; then
  # films the dist/prod packed above (no rebuild); a scene that fails fails the release
  node demo/record.ts
  ./demo/encode.sh
else
  echo "demo not re-recorded (just publish does) — docs/assets/demo/ and docs/assets/features/ keep the previous take"
fi
