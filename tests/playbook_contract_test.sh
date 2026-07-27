#!/usr/bin/env bash
# Contract checks intentionally search for literal shell syntax.
# shellcheck disable=SC2016

set -eu

ROOT=$(git rev-parse --show-toplevel)
BUILD="$ROOT/loop/build.md"
REVIEW="$ROOT/loop/review.md"
SCHEDULE="$ROOT/.agents/skills/gsd-loop-schedule/SKILL.md"
AGENT_GUIDE="$ROOT/AGENTS.md"
README="$ROOT/README.md"
INSTALL_GUIDE="$ROOT/docs/install.md"

repair_section=$(sed -n '/^## Repair queue takes priority/,/^## Choose an issue/p' "$BUILD")
printf '%s\n' "$repair_section" | grep -q 'dependency manifest or lockfile'
if printf '%s\n' "$repair_section" | grep -q 'issue contract or repository guidance'; then
  echo 'dependency audits must not depend on an opt-in issue contract' >&2
  exit 1
fi

grep -q 'gh api graphql --paginate --slurp' "$REVIEW"
grep -q 'comments(first: 100, after: $endCursor)' "$REVIEW"
grep -q 'pageInfo { hasNextPage endCursor }' "$REVIEW"
grep -q 'Dependency audit for HEAD_SHA: baseline compared' "$BUILD"
grep -q 'Dependency audit for HEAD_SHA: baseline compared' "$REVIEW"
printf '%s\n' "$repair_section" | grep -q 'gh api --paginate --slurp'
if printf '%s\n' "$repair_section" | grep -q 'commands and result'; then
  echo 'repair evidence must use normalized JSON' >&2
  exit 1
fi
grep -q 'gsd-loop/dependency-audit-v1' "$BUILD"
grep -q 'gsd-loop/dependency-audit-v1' "$REVIEW"
grep -q 'REVIEWER_LOGIN=$(gh api user --jq .login)' "$REVIEW"
grep -q 'gsd-loop verdict for HEAD_SHA issue #ISSUE' "$REVIEW"
grep -q 'trusted verdict anywhere in the trail' "$REVIEW"
grep -q 'node AUDIT_VALIDATOR --baseline BASE_REF_OID --head HEAD_REF_OID' "$REVIEW"
grep -q 'PR_EVIDENCE' "$REVIEW"
grep -q 'repository identity matches `OWNER/REPO`' "$REVIEW"
grep -q 'pending-ci-NUMBER-HEAD_SHA' "$REVIEW"
grep -q 'node OUTCOME_SYNC ISSUE pending --repo OWNER/REPO --pr NUMBER --head HEAD_SHA' "$REVIEW"
grep -q 'node OUTCOME_SYNC ISSUE complete --repo OWNER/REPO --pr NUMBER --head HEAD_SHA' "$REVIEW"
grep -q 'gh pr edit NUMBER --remove-label gsd:approved' "$REVIEW"
grep -q 'gsd-loop linkage block for HEAD_SHA' "$REVIEW"
grep -q 'no conditional' "$REVIEW"
grep -q 'outcomes-invalidated' "$REVIEW"
grep -q 'The verdict comment,' "$REVIEW"
grep -q 'issue outcome checkboxes, and labels are the whole interface' "$REVIEW"

grep -q 'Codex, Cursor, or Gemini: `$gsd-loop-build` or `$gsd-loop-review`' "$SCHEDULE"
grep -q 'Claude Code: `/gsd-loop-build` or `/gsd-loop-review`' "$SCHEDULE"
grep -q 'Kimi Code: `/skill:gsd-loop-build` or `/skill:gsd-loop-review`' "$SCHEDULE"
grep -q 'npx @opengsd/gsd-loop@latest policy EVENT IDLE_COUNT' "$SCHEDULE"
if grep -q 'npx @opengsd/gsd-loop@latest run' "$SCHEDULE"; then
  echo 'native scheduling must invoke installed skills instead of a subprocess runner' >&2
  exit 1
fi
for guide in "$AGENT_GUIDE" "$README" "$INSTALL_GUIDE"; do
  grep -q '/gsd-loop-schedule' "$guide"
  grep -q '/skill:gsd-loop-schedule' "$guide"
  if grep -q '/loop /gsd-loop-' "$guide"; then
    echo 'documentation must route recurring work through the scheduling skill' >&2
    exit 1
  fi
done

echo 'playbook contracts passed'
