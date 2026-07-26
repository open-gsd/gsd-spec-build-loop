#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
VALIDATOR="$ROOT/scripts/validate-skills.py"

"$VALIDATOR" "$ROOT/.agents/skills"

if "$VALIDATOR" "$ROOT/tests/fixtures/invalid-skills" >/tmp/gsd-invalid-skill.out 2>&1; then
  echo 'invalid skill fixture must fail validation' >&2
  exit 1
fi
grep -q 'folder name must match skill name' /tmp/gsd-invalid-skill.out
