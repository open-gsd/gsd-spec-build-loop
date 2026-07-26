#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
FIXTURE_PATH="$ROOT/tests/fixtures/bin:$PATH"
REPO=open-gsd/gsd-spec-build-loop

MOCK_REQUIRED_CHECKS=0 PATH="$FIXTURE_PATH" "$ROOT/scripts/doctor.sh" "$REPO" >/tmp/gsd-doctor-default.out

if MOCK_REQUIRED_CHECKS=0 PATH="$FIXTURE_PATH" "$ROOT/scripts/doctor.sh" --review-ready "$REPO" >/tmp/gsd-doctor-strict.out 2>&1; then
  echo 'review-ready mode must fail without required checks' >&2
  exit 1
fi
grep -q 'required status checks are required for review scheduling' /tmp/gsd-doctor-strict.out

MOCK_REQUIRED_CHECKS=1 PATH="$FIXTURE_PATH" "$ROOT/scripts/doctor.sh" --review-ready "$REPO" >/tmp/gsd-doctor-ready.out
grep -q 'doctor: ready' /tmp/gsd-doctor-ready.out
