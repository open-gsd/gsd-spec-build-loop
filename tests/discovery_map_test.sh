#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
node "$ROOT/tests/discovery_map_test.mjs"
