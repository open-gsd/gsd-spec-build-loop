#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

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
