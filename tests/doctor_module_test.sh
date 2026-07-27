#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
node "$ROOT/tests/doctor_module_test.mjs"
