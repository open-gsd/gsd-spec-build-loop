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

NPM_LOG="$TEST_ROOT/published.log" \
  GITHUB_REF=refs/heads/main \
  PATH="$ROOT/tests/fixtures/bin:$PATH" \
  "$ROOT/scripts/publish.sh"

EXPECTED=$(printf 'ci\npublish')
ACTUAL=$(sed -n '1,3p' "$TEST_ROOT/published.log")
test "$ACTUAL" = "$EXPECTED"

echo "publish workflow passed"
