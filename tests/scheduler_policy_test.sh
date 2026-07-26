#!/usr/bin/env bash
set -eu

POLICY="$(git rev-parse --show-toplevel)/scripts/scheduler-policy.sh"

assert_policy() {
  expected=$1
  event=$2
  idle_count=$3
  actual=$("$POLICY" "$event" "$idle_count")
  [ "$actual" = "$expected" ] || {
    printf 'expected: %s\nactual:   %s\n' "$expected" "$actual" >&2
    exit 1
  }
}

assert_policy 'action=continue interval_minutes=15 idle_count=0' work 2
assert_policy 'action=continue interval_minutes=60 idle_count=1' idle 0
assert_policy 'action=continue interval_minutes=60 idle_count=2' idle 1
assert_policy 'action=pause interval_minutes=0 idle_count=3' idle 2
assert_policy 'action=pause interval_minutes=0 idle_count=1' blocked 1

if "$POLICY" idle invalid >/dev/null 2>&1; then
  echo 'invalid idle counts must fail' >&2
  exit 1
fi
