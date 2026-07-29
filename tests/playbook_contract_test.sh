#!/usr/bin/env bash
# Contract checks intentionally search for literal shell syntax.
# shellcheck disable=SC2016

set -eu

ROOT=$(git rev-parse --show-toplevel)
DISCOVER="$ROOT/loop/discover.md"
SPEC="$ROOT/loop/spec.md"
BUILD="$ROOT/loop/build.md"
REVIEW="$ROOT/loop/review.md"
SCHEDULE="$ROOT/.agents/skills/gsd-loop-schedule/SKILL.md"
AGENT_GUIDE="$ROOT/AGENTS.md"
README="$ROOT/README.md"
INSTALL_GUIDE="$ROOT/docs/install.md"

grep -q '^# gsd-loop: discover' "$DISCOVER"
grep -qi 'interactive only' "$DISCOVER"
grep -q 'exactly one frontier decision' "$DISCOVER"
grep -q 'sub_issues' "$DISCOVER"
grep -q 'dependencies/blocked_by' "$DISCOVER"
grep -q 'Ready for `gsd-loop-spec`.' "$DISCOVER"
grep -q 'never apply `gsd:ready`' "$DISCOVER"
grep -q '^## Delivery slices' "$DISCOVER"
grep -q '^## Decision frontier' "$DISCOVER"
grep -q '^### S-1 — <queue issue title>' "$DISCOVER"
grep -q 'node MAP_VALIDATOR /path/to/map-body.md' "$DISCOVER"
grep -q 'collectively cover the destination' "$DISCOVER"
grep -q 'Recover an interrupted pass' "$DISCOVER"
grep -q 'Never post a second resolution comment' "$DISCOVER"
grep -q 'resume it as this pass.s chosen decision' "$DISCOVER"
grep -q 'no list marker' "$DISCOVER"
grep -q '## Map gist' "$DISCOVER"
grep -q 'map copies that line verbatim' "$DISCOVER"
grep -q 'node DISCOVERY_PROTOCOL reconcile MAP --repo OWNER/REPO' "$DISCOVER"
grep -q 'node DISCOVERY_PROTOCOL graduate MAP --repo OWNER/REPO' "$DISCOVER"
grep -q -- '--body-file /path/to/map-body.md' "$DISCOVER"
grep -q 'helper validates the exact proposed body' "$DISCOVER"
grep -q 'loop/discover.md' "$ROOT/.agents/skills/gsd-loop-discover/SKILL.md"
grep -q 'Optional discovery-map input' "$SPEC"
grep -q 'carries `gsd:map`' "$SPEC"
grep -q 'every native sub-issue is closed' "$SPEC"
grep -q 'node DISCOVERY_PROTOCOL recover-slices MAP' "$SPEC"
grep -q 'node DISCOVERY_PROTOCOL file-slice MAP' "$SPEC"
grep -q 'If it returns `approvalRequired`' "$SPEC"
grep -q 'Concurrent same-map passes are' "$SPEC"
grep -q 'including passes authenticated as the same GitHub login' "$DISCOVER"
grep -q 'IDs become permanent only at graduation' "$DISCOVER"
grep -q 'Do not automatically reorder, renumber, or rewrite' "$DISCOVER"
grep -q 'Once the first slice issue is filed' "$DISCOVER"
grep -q 'requires a new discovery map' "$SPEC"
grep -q 'node DISCOVERY_PROTOCOL complete-map MAP --repo OWNER/REPO' "$SPEC"
if grep -Eq 'DISCOVERY_PROTOCOL (lock|unlock|approve-slice)|filing reservation|Approved sha256:' "$SPEC"; then
  echo 'spec must use the single-pass marker recovery contract' >&2
  exit 1
fi
grep -q 'gsd-loop-discover MAP' "$SPEC"
grep -q 'map graduation is not build' "$SPEC"
grep -q 'human explicitly confirms' "$SPEC"
grep -q 'one queue issue per unfiled delivery slice' "$SPEC"
grep -q 'Needs #ISSUE merged' "$SPEC"
grep -q 'Multiple ready slices are processed over' "$SPEC"
tr '\n' ' ' < "$ROOT/.agents/skills/gsd-loop-discover/SKILL.md" |
  grep -q 'resolve it to.*validate-discovery-map.mjs'
tr '\n' ' ' < "$ROOT/.agents/skills/gsd-loop-spec/SKILL.md" |
  grep -q 'resolve it to.*validate-discovery-map.mjs'
grep -q 'manage-discovery.mjs' "$ROOT/.agents/skills/gsd-loop-discover/SKILL.md"
grep -q 'manage-discovery.mjs' "$ROOT/.agents/skills/gsd-loop-spec/SKILL.md"
grep -q 'Discard issues labeled `gsd:map`' "$BUILD"

repair_section=$(sed -n '/^## Repair queue takes priority/,/^## Choose an issue/p' "$BUILD")
recovery_section=$(printf '%s\n' "$repair_section" |
  sed -n '/Trusted verdict SHA already matches/,/Can.t check out the branch/p')
printf '%s\n' "$repair_section" | grep -q 'dependency manifest or lockfile'
printf '%s\n' "$recovery_section" |
  grep -q 'node LINKAGE_SYNC ISSUE --repo OWNER/REPO --pr NUMBER --head HEAD_SHA'
if printf '%s\n' "$repair_section" | grep -q 'issue contract or repository guidance'; then
  echo 'dependency audits must not depend on an opt-in issue contract' >&2
  exit 1
fi

grep -q 'gh api graphql --paginate --slurp' "$REVIEW"
grep -q 'comments(first: 100, after: $endCursor)' "$REVIEW"
grep -q 'pageInfo { hasNextPage endCursor }' "$REVIEW"
grep -q 'Dependency audit for HEAD_SHA: baseline compared' "$BUILD"
grep -q 'node LINKAGE_SYNC ISSUE --repo OWNER/REPO --pr NUMBER --head HEAD_SHA' "$BUILD"
grep -q 'resolve `LINKAGE_SYNC` to `scripts/ensure-linkage.mjs`' "$ROOT/.agents/skills/gsd-loop-build/SKILL.md"
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

grep -q 'Codex: `$gsd-loop-build` or `$gsd-loop-review`' "$SCHEDULE"
grep -q 'Claude Code: `/gsd-loop-build` or `/gsd-loop-review`' "$SCHEDULE"
grep -q 'Cursor: `/gsd-loop-build` or `/gsd-loop-review`' "$SCHEDULE"
grep -q 'Gemini CLI: `Use the gsd-loop-build skill` or `Use the gsd-loop-review skill`' "$SCHEDULE"
grep -q 'Grok Build: `/gsd-loop-build` or `/gsd-loop-review`' "$SCHEDULE"
grep -q 'Kimi Code: `/skill:gsd-loop-build` or `/skill:gsd-loop-review`' "$SCHEDULE"
grep -q 'npx @opengsd/gsd-loop@latest policy EVENT IDLE_COUNT' "$SCHEDULE"
if grep -q 'npx @opengsd/gsd-loop@latest run' "$SCHEDULE"; then
  echo 'native scheduling must invoke installed skills instead of a subprocess runner' >&2
  exit 1
fi
for guide in "$AGENT_GUIDE" "$README" "$INSTALL_GUIDE"; do
  grep -q 'gsd-loop-discover' "$guide"
  grep -q '/gsd-loop-schedule' "$guide"
  grep -q '/skill:gsd-loop-schedule' "$guide"
  grep -q 'Use the gsd-loop-schedule skill' "$guide"
  if grep -q '/loop /gsd-loop-' "$guide"; then
    echo 'documentation must route recurring work through the scheduling skill' >&2
    exit 1
  fi
done
grep -Fq '| Codex | `$gsd-loop-discover` | `$gsd-loop-spec` | `$gsd-loop-build` | `$gsd-loop-review` | `$gsd-loop-schedule` |' "$AGENT_GUIDE"
grep -Fq '| Claude Code | `/gsd-loop-discover` | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |' "$AGENT_GUIDE"
grep -Fq '| Cursor | `/gsd-loop-discover` | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |' "$AGENT_GUIDE"
grep -Fq '| Gemini CLI | `Use the gsd-loop-discover skill` | `Use the gsd-loop-spec skill` | `Use the gsd-loop-build skill` | `Use the gsd-loop-review skill` | `Use the gsd-loop-schedule skill` |' "$AGENT_GUIDE"
grep -Fq '| Grok Build | `/gsd-loop-discover` | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |' "$AGENT_GUIDE"
grep -Fq '| Kimi Code | `/skill:gsd-loop-discover` | `/skill:gsd-loop-spec` | `/skill:gsd-loop-build` | `/skill:gsd-loop-review` | `/skill:gsd-loop-schedule` |' "$AGENT_GUIDE"
if [ "$(grep -c 'npx @opengsd/gsd-loop@latest init' "$README")" -ne 1 ]; then
  echo 'README must contain exactly one npm bootstrap command' >&2
  exit 1
fi
if grep -q 'npx @opengsd/gsd-loop@latest doctor' "$README"; then
  echo 'README must leave standalone diagnostics to the installation guide' >&2
  exit 1
fi

echo 'playbook contracts passed'
