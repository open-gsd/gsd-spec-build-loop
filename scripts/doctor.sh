#!/usr/bin/env bash
# gsd-loop doctor — verifies an environment can run the loop against a repo.
# Usage: scripts/doctor.sh [--review-ready] [owner/repo]
set -u

FAIL=0
REVIEW_READY=0
ok()   { printf 'ok    %s\n' "$1"; }
warn() { printf 'warn  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; FAIL=1; }

if [ "${1:-}" = "--review-ready" ]; then
  REVIEW_READY=1
  shift
fi

if [ "$#" -gt 1 ]; then
  echo "usage: scripts/doctor.sh [--review-ready] [owner/repo]" >&2
  exit 2
fi

command -v gh >/dev/null 2>&1 || { bad "gh CLI not installed"; exit 1; }
ok "gh $(gh --version | head -1 | awk '{print $3}')"

if gh auth status >/dev/null 2>&1; then
  ok "gh authenticated"
else
  bad "gh not authenticated (run: gh auth login)"
fi

REPO="${1:-}"
if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null) \
    || { bad "no repo argument and current directory is not a GitHub repo"; exit 1; }
fi
ok "repo $REPO"

PERM=$(gh api "repos/$REPO" --jq .permissions.push 2>/dev/null)
if [ "$PERM" = "true" ]; then
  ok "push access"
else
  bad "no push access to $REPO"
fi

BRANCH=$(gh api "repos/$REPO" --jq .default_branch 2>/dev/null)
ok "default branch: ${BRANCH:-unknown}"

MISSING=""
for l in gsd:ready gsd:blocked gsd:approved gsd:rework gsd:escalated; do
  gh label list --repo "$REPO" --search "$l" --json name --jq '.[].name' 2>/dev/null \
    | grep -qx "$l" || MISSING="$MISSING $l"
done
if [ -z "$MISSING" ]; then
  ok "all five gsd: labels exist"
else
  warn "labels missing (created automatically on first pass):$MISSING"
fi

# Required checks: query active branch rules (covers rulesets and classic protection).
RULES=$(gh api "repos/$REPO/rules/branches/$BRANCH" --jq '[.[] | select(.type == "required_status_checks")] | length' 2>/dev/null || echo "")
if [ "${RULES:-0}" -ge 1 ] 2>/dev/null; then
  ok "required status checks configured on $BRANCH"
elif [ "$REVIEW_READY" -eq 1 ]; then
  bad "required status checks are required for review scheduling on $BRANCH"
else
  warn "no required status checks detected on $BRANCH — the reviewer will escalate every PR (gsd:escalated) until CI is required"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "doctor: ready"
else
  echo "doctor: NOT ready"
fi
exit "$FAIL"
