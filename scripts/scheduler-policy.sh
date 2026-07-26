#!/usr/bin/env bash
set -eu

EVENT=${1:-}
IDLE_COUNT=${2:-}

case "$IDLE_COUNT" in
  ''|*[!0-9]*)
    echo 'idle count must be a non-negative integer' >&2
    exit 2
    ;;
esac

case "$EVENT" in
  work)
    echo 'action=continue interval_minutes=15 idle_count=0'
    ;;
  idle)
    IDLE_COUNT=$((IDLE_COUNT + 1))
    if [ "$IDLE_COUNT" -ge 3 ]; then
      echo 'action=pause interval_minutes=0 idle_count=3'
    else
      printf 'action=continue interval_minutes=60 idle_count=%s\n' "$IDLE_COUNT"
    fi
    ;;
  blocked)
    printf 'action=pause interval_minutes=0 idle_count=%s\n' "$IDLE_COUNT"
    ;;
  *)
    echo 'event must be work, idle, or blocked' >&2
    exit 2
    ;;
esac
