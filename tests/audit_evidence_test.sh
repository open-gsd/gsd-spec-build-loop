#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
node "$ROOT/tests/audit_evidence_test.mjs"
