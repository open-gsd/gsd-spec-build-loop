#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
SOURCE_CLI="$SCRIPT_DIR/../bin/gsd-loop.mjs"

if [ -f "$SOURCE_CLI" ]; then
  exec node "$SOURCE_CLI" policy "$@"
fi

exec npx @opengsd/gsd-loop@latest policy "$@"
