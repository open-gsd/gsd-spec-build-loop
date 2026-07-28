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

MAIN_SHA=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq '.object.sha')
if [ "$GITHUB_SHA" != "$MAIN_SHA" ]; then
  echo "publish commit is not the current main commit" >&2
  exit 2
fi

SUCCESSFUL_CI_RUNS=$(gh api \
  "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs" \
  --method GET \
  -f branch=main \
  -f event=push \
  -f "head_sha=$GITHUB_SHA" \
  -f status=completed \
  --jq '[.workflow_runs[] | select(.conclusion == "success")] | length')
if [ "$SUCCESSFUL_CI_RUNS" -eq 0 ]; then
  echo "current main commit does not have a successful CI run" >&2
  exit 2
fi

npm ci
NPM_ERROR=$(mktemp)
GH_ERROR=$(mktemp)
trap 'rm -f "$NPM_ERROR" "$GH_ERROR"' EXIT HUP INT TERM

if PACKAGE_METADATA=$(npm view "$PACKAGE_NAME@$PACKAGE_VERSION" version gitHead --json 2>"$NPM_ERROR"); then
  PUBLISHED_COMMIT=$(printf '%s' "$PACKAGE_METADATA" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const metadata = JSON.parse(input);
      if (!metadata.gitHead || !/^[0-9a-f]{40}$/.test(metadata.gitHead)) process.exit(1);
      process.stdout.write(metadata.gitHead);
    });
  ') || {
    echo "$PACKAGE_NAME@$PACKAGE_VERSION has no valid gitHead provenance" >&2
    exit 1
  }
  echo "$PACKAGE_NAME@$PACKAGE_VERSION is already published"
elif grep -q 'E404' "$NPM_ERROR"; then
  PUBLISHED_COMMIT=$GITHUB_SHA
  npm publish
else
  cat "$NPM_ERROR" >&2
  exit 1
fi

RESOLVED_COMMIT=$(gh api \
  "repos/$GITHUB_REPOSITORY/commits/$PUBLISHED_COMMIT" \
  --jq '.sha')
if [ "$RESOLVED_COMMIT" != "$PUBLISHED_COMMIT" ]; then
  echo "published commit does not belong to $GITHUB_REPOSITORY" >&2
  exit 1
fi

if gh api \
  "repos/$GITHUB_REPOSITORY/releases/tags/$RELEASE_TAG" \
  --silent 2>"$GH_ERROR"; then
  RELEASE_COMMIT=$(gh api \
    "repos/$GITHUB_REPOSITORY/commits/$RELEASE_TAG" \
    --jq '.sha')
  if [ "$RELEASE_COMMIT" != "$PUBLISHED_COMMIT" ]; then
    echo "GitHub release $RELEASE_TAG does not target published commit $PUBLISHED_COMMIT" >&2
    exit 1
  fi
  echo "GitHub release $RELEASE_TAG already exists"
elif grep -q 'HTTP 404' "$GH_ERROR"; then
  gh release create "$RELEASE_TAG" \
    --repo "$GITHUB_REPOSITORY" \
    --target "$PUBLISHED_COMMIT" \
    --title "$RELEASE_TAG" \
    --generate-notes
else
  cat "$GH_ERROR" >&2
  exit 1
fi
