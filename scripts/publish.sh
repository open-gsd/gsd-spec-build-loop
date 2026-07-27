#!/bin/sh
set -eu

if [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
  echo "npm publishes must run from main" >&2
  exit 2
fi

npm ci
npm publish
