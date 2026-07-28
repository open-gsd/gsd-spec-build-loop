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

expected_actions = [
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
]
actual_actions = publish_job.fetch("steps").map { |step| step["uses"] }.compact
abort "publish actions must use approved commit pins" unless actual_actions == expected_actions
RUBY

if NPM_LOG="$TEST_ROOT/rejected.log" \
  GITHUB_REF=refs/heads/not-main \
  PATH="$ROOT/tests/fixtures/bin:$PATH" \
  "$ROOT/scripts/publish.sh" 2>/dev/null; then
  echo "publish driver accepted a non-main ref" >&2
  exit 1
fi
test ! -e "$TEST_ROOT/rejected.log"

run_publish() {
  NPM_LOG="$TEST_ROOT/published.log" \
    GH_LOG="$TEST_ROOT/github.log" \
    GH_RELEASE_STATE="$TEST_ROOT/release-state" \
    MOCK_NPM_VERSION_EXISTS=${1:-0} \
    GITHUB_REPOSITORY=open-gsd/gsd-spec-build-loop \
    GITHUB_SHA=0123456789abcdef0123456789abcdef01234567 \
    GITHUB_REF=refs/heads/main \
    PATH="$ROOT/tests/fixtures/bin:$PATH" \
    "$ROOT/scripts/publish.sh"
}

run_publish

EXPECTED_NPM=$(printf 'ci\nview @opengsd/gsd-loop@0.2.5 version --json\npublish')
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_NPM"
test "$(cat "$TEST_ROOT/release-state")" = v0.2.5
grep -q '^release create v0.2.5 .*--target 0123456789abcdef0123456789abcdef01234567 .*--generate-notes' "$TEST_ROOT/github.log"

: > "$TEST_ROOT/published.log"
: > "$TEST_ROOT/github.log"
rm "$TEST_ROOT/release-state"
run_publish 1
EXPECTED_RECOVERY=$(printf 'ci\nview @opengsd/gsd-loop@0.2.5 version --json')
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_RECOVERY"
test "$(cat "$TEST_ROOT/release-state")" = v0.2.5

: > "$TEST_ROOT/published.log"
: > "$TEST_ROOT/github.log"
run_publish 1
test "$(cat "$TEST_ROOT/published.log")" = "$EXPECTED_RECOVERY"
test "$(cat "$TEST_ROOT/github.log")" = "release view v0.2.5 --repo open-gsd/gsd-spec-build-loop"

echo "publish workflow passed"
