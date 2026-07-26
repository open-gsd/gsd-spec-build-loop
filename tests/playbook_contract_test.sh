#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
BUILD="$ROOT/loop/build.md"
REVIEW="$ROOT/loop/review.md"
SCHEDULE="$ROOT/.agents/skills/gsd-loop-schedule/SKILL.md"

repair_section=$(sed -n '/^## Repair queue takes priority/,/^## Choose an issue/p' "$BUILD")
printf '%s\n' "$repair_section" | grep -q 'dependency manifest or lockfile'
printf '%s\n' "$repair_section" | grep -q 'issue contract or repository guidance'

grep -q 'gh pr view NUMBER --json files' "$REVIEW"
grep -q 'Dependency audit: baseline compared' "$REVIEW"
grep -q 'pending-ci-NUMBER-HEAD_SHA' "$REVIEW"

grep -q 'npx @opengsd/gsd-loop@latest run LANE --once' "$SCHEDULE"
grep -q 'npx @opengsd/gsd-loop@latest policy EVENT IDLE_COUNT' "$SCHEDULE"
if grep -q 'Put `\$gsd-loop-build` or `\$gsd-loop-review` in the scheduled prompt' "$SCHEDULE"; then
  echo 'native scheduling must not bypass the portable runner lock' >&2
  exit 1
fi

echo 'playbook contracts passed'
