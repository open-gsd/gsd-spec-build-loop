#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
BUILD="$ROOT/loop/build.md"
REVIEW="$ROOT/loop/review.md"
SCHEDULE="$ROOT/.agents/skills/gsd-loop-schedule/SKILL.md"

repair_section=$(sed -n '/^## Repair queue takes priority/,/^## Choose an issue/p' "$BUILD")
printf '%s\n' "$repair_section" | grep -q 'dependency manifest or lockfile'
if printf '%s\n' "$repair_section" | grep -q 'issue contract or repository guidance'; then
  echo 'dependency audits must not depend on an opt-in issue contract' >&2
  exit 1
fi

grep -q 'gh pr view NUMBER --json files' "$REVIEW"
grep -q 'Dependency audit: baseline compared' "$REVIEW"
grep -q 'pending-ci-NUMBER-HEAD_SHA' "$REVIEW"
grep -q 'gsd-loop outcomes ISSUE pending --repo OWNER/REPO --pr NUMBER --head HEAD_SHA' "$REVIEW"
grep -q 'gsd-loop outcomes ISSUE complete --repo OWNER/REPO --pr NUMBER --head HEAD_SHA' "$REVIEW"
grep -q 'outcomes-invalidated' "$REVIEW"
grep -q 'The verdict comment,' "$REVIEW"
grep -q 'issue outcome checkboxes, and labels are the whole interface' "$REVIEW"

grep -q 'npx @opengsd/gsd-loop@latest run LANE --once' "$SCHEDULE"
grep -q 'npx @opengsd/gsd-loop@latest policy EVENT IDLE_COUNT' "$SCHEDULE"
# The literal '$' is matched on purpose (grep pattern, no shell expansion wanted).
# shellcheck disable=SC2016
if grep -q 'Put `$gsd-loop-build` or `$gsd-loop-review` in the scheduled prompt' "$SCHEDULE"; then
  echo 'native scheduling must not bypass the portable runner lock' >&2
  exit 1
fi

echo 'playbook contracts passed'
