#!/bin/sh
set -eu

if [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
  echo "npm publishes must run from main" >&2
  exit 2
fi

PACKAGE_NAME=$(node -p 'require("./package.json").name')
PACKAGE_VERSION=$(node -p 'require("./package.json").version')
RELEASE_TAG="v$PACKAGE_VERSION"
: "${GITHUB_REPOSITORY:?GitHub repository is required}"
: "${GITHUB_SHA:?GitHub commit SHA is required}"

npm ci
if npm view "$PACKAGE_NAME@$PACKAGE_VERSION" version --json >/dev/null 2>&1; then
  echo "$PACKAGE_NAME@$PACKAGE_VERSION is already published"
else
  npm publish
fi

if gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  echo "GitHub release $RELEASE_TAG already exists"
else
  gh release create "$RELEASE_TAG" \
    --repo "$GITHUB_REPOSITORY" \
    --target "$GITHUB_SHA" \
    --title "$RELEASE_TAG" \
    --generate-notes
fi
