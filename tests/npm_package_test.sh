#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
node "$ROOT/tests/npm_package_test.mjs"
