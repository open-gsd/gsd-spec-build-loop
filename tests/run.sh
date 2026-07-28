#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)

for test_file in "$ROOT"/tests/*_test.sh; do
  "$test_file"
done

node "$ROOT/tests/cli_workflow_test.mjs"
node "$ROOT/tests/claude_skill_entrypoints_test.mjs"
