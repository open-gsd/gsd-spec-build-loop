#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

WORKFLOW_FILE=${WORKFLOW_FILE:-"$ROOT/.github/workflows/publish.yml"}

ruby - "$WORKFLOW_FILE" <<'RUBY'
require "yaml"

workflow = YAML.safe_load(File.read(ARGV.fetch(0)))
publish_job = workflow.fetch("jobs").fetch("publish")
abort "publish job must use the npm environment" unless publish_job["environment"] == "npm"
contents_permission = workflow.fetch("permissions").fetch("contents")
abort "publish workflow must create GitHub releases" unless contents_permission == "write"
actions_permission = workflow.fetch("permissions").fetch("actions")
abort "publish workflow must inspect CI runs" unless actions_permission == "read"

expected_actions = [
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
]
actual_actions = publish_job.fetch("steps").map { |step| step["uses"] }.compact
abort "publish actions must use approved commit pins" unless actual_actions == expected_actions
publish_step = publish_job.fetch("steps").find { |step| step["run"] == "scripts/publish.sh" }
abort "publish step must authenticate gh" unless publish_step.dig("env", "GH_TOKEN") == "${{ github.token }}"
RUBY

if NPM_LOG="$TEST_ROOT/rejected.log" \
  GITHUB_REF=refs/heads/not-main \
  PATH="$ROOT/tests/fixtures/bin:$PATH" \
  "$ROOT/scripts/publish.sh" 2>/dev/null; then
  echo "publish driver accepted a non-main ref" >&2
  exit 1
fi
test ! -e "$TEST_ROOT/rejected.log"

CURRENT_SHA=0123456789abcdef0123456789abcdef01234567
PUBLISHED_SHA=abcdef0123456789abcdef0123456789abcdef01

run_publish() {
  NPM_LOG="$TEST_ROOT/published.log" \
    GH_LOG="$TEST_ROOT/github.log" \
    GH_RELEASE_STATE="$TEST_ROOT/release-state" \
    GH_RELEASE_COMMIT_STATE="$TEST_ROOT/release-commit-state" \
    MOCK_MAIN_SHA=${MOCK_MAIN_SHA:-$CURRENT_SHA} \
    MOCK_SUCCESSFUL_CI_RUNS=${MOCK_SUCCESSFUL_CI_RUNS:-1} \
    MOCK_NPM_VIEW_RESULT=${MOCK_NPM_VIEW_RESULT:-missing} \
    MOCK_NPM_GIT_HEAD=${MOCK_NPM_GIT_HEAD:-$CURRENT_SHA} \
    MOCK_RELEASE_RESULT=${MOCK_RELEASE_RESULT:-missing} \
    MOCK_RELEASE_COMMIT=${MOCK_RELEASE_COMMIT:-$CURRENT_SHA} \
    MOCK_RESOLVED_COMMIT=${MOCK_RESOLVED_COMMIT:-} \
    GITHUB_REPOSITORY=open-gsd/gsd-spec-build-loop \
    GITHUB_SHA=$CURRENT_SHA \
    GITHUB_REF=refs/heads/main \
    PATH="$ROOT/tests/fixtures/bin:$PATH" \
    "$ROOT/scripts/publish.sh"
}

if MOCK_MAIN_SHA=$PUBLISHED_SHA run_publish 2>/dev/null; then
  echo "publish driver accepted a stale main commit" >&2
  exit 1
fi
test ! -e "$TEST_ROOT/published.log"

if MOCK_SUCCESSFUL_CI_RUNS=0 run_publish 2>/dev/null; then
  echo "publish driver accepted a main commit without green CI" >&2
  exit 1
fi
test ! -e "$TEST_ROOT/published.log"

run_publish

EXPECTED_NPM=$(printf 'ci\nview @opengsd/gsd-loop@0.2.5 version gitHead --json\npublish')
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_NPM"
test "$(cat "$TEST_ROOT/release-state")" = v0.2.5
test "$(cat "$TEST_ROOT/release-commit-state")" = "$CURRENT_SHA"
grep -q "^release create v0.2.5 .*--target $CURRENT_SHA .*--generate-notes" "$TEST_ROOT/github.log"

: > "$TEST_ROOT/published.log"
: > "$TEST_ROOT/github.log"
rm "$TEST_ROOT/release-state"
rm "$TEST_ROOT/release-commit-state"
MOCK_NPM_VIEW_RESULT=exists MOCK_NPM_GIT_HEAD=$PUBLISHED_SHA run_publish
EXPECTED_RECOVERY=$(printf 'ci\nview @opengsd/gsd-loop@0.2.5 version gitHead --json')
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_RECOVERY"
test "$(cat "$TEST_ROOT/release-state")" = v0.2.5
test "$(cat "$TEST_ROOT/release-commit-state")" = "$PUBLISHED_SHA"

: > "$TEST_ROOT/published.log"
: > "$TEST_ROOT/github.log"
MOCK_NPM_VIEW_RESULT=exists \
  MOCK_NPM_GIT_HEAD=$PUBLISHED_SHA \
  MOCK_RELEASE_RESULT=exists \
  MOCK_RELEASE_COMMIT=$PUBLISHED_SHA \
  run_publish
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_RECOVERY"
test ! -s "$TEST_ROOT/github.log"

: > "$TEST_ROOT/published.log"
if MOCK_NPM_VIEW_RESULT=error run_publish 2>/dev/null; then
  echo "publish driver treated an npm error as a missing package" >&2
  exit 1
fi
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_RECOVERY"

: > "$TEST_ROOT/published.log"
if MOCK_NPM_VIEW_RESULT=exists MOCK_NPM_GIT_HEAD=unknown run_publish 2>/dev/null; then
  echo "publish driver accepted package metadata without commit provenance" >&2
  exit 1
fi
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_RECOVERY"

: > "$TEST_ROOT/published.log"
if MOCK_NPM_VIEW_RESULT=exists \
  MOCK_NPM_GIT_HEAD=$PUBLISHED_SHA \
  MOCK_RESOLVED_COMMIT=$CURRENT_SHA \
  run_publish 2>/dev/null; then
  echo "publish driver accepted provenance from another repository" >&2
  exit 1
fi
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_RECOVERY"

: > "$TEST_ROOT/published.log"
if MOCK_NPM_VIEW_RESULT=exists \
  MOCK_NPM_GIT_HEAD=$PUBLISHED_SHA \
  MOCK_RELEASE_RESULT=exists \
  MOCK_RELEASE_COMMIT=$CURRENT_SHA \
  run_publish 2>/dev/null; then
  echo "publish driver accepted a release targeting the wrong commit" >&2
  exit 1
fi
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_RECOVERY"

: > "$TEST_ROOT/published.log"
if MOCK_NPM_VIEW_RESULT=exists \
  MOCK_NPM_GIT_HEAD=$PUBLISHED_SHA \
  MOCK_RELEASE_RESULT=error \
  run_publish 2>/dev/null; then
  echo "publish driver treated a GitHub error as a missing release" >&2
  exit 1
fi
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_RECOVERY"

echo "publish workflow passed"
