#!/usr/bin/env bash
# Code gate: lint + typecheck + full test suite, via the just recipes.
set -euo pipefail
ROOT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_PATH"

just check
echo "validate_code: lint + typecheck + tests OK"
