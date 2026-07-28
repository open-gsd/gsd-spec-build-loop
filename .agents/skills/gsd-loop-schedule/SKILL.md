---
name: gsd-loop-schedule
description: Create or update a native recurring task that repeatedly runs one-pass gsd-loop builder or reviewer work. Use when asked to keep the build or review queue running, schedule gsd-loop, or automate repeated passes.
---

Use the host's native recurring-task tool. In Codex, use the native
scheduled-task tool. If the host has no recurring-task capability, stop and
explain that this scheduling skill is unsupported there. Do not start a shell
`while` loop or launch a separate agent process.

1. Resolve the repository root and `owner/repo`. Schedule exactly one lane in
   the current chat: build by default, or review when explicitly requested.
2. Run `npx @opengsd/gsd-loop@latest doctor` before build scheduling. Add
   `--review-ready` before review scheduling. Do not create or update a review
   task when that stricter check fails.
3. Use the deterministic name `gsd-loop LANE — owner/repo`. Inspect existing
   scheduled tasks first. Update an exact match instead of duplicating it. If a
   different active builder targets the same repository, stop and identify it.
4. Attach the task to the current chat, start at 15 minutes, and initialize its
   lane-specific idle count to zero. Keep any repository-local scheduler state
   at `.gsd/scheduled_tasks.lock`; never write it under a harness-specific
   directory such as `.claude/`.
5. Put the lane skill in the scheduled prompt using the current host's native
   invocation syntax:
   - Codex: `$gsd-loop-build` or `$gsd-loop-review`
   - Claude Code: `/gsd-loop-build` or `/gsd-loop-review`
   - Cursor: `/gsd-loop-build` or `/gsd-loop-review`
   - Gemini CLI: `Use the gsd-loop-build skill` or `Use the gsd-loop-review skill`
   - Kimi Code: `/skill:gsd-loop-build` or `/skill:gsd-loop-review`
   Run exactly one playbook pass per wake and require its final
   `GSD_LOOP_RESULT` line. A missing or malformed result is `blocked`, never
   inferred from prose.
6. After each pass, run
   `npx @opengsd/gsd-loop@latest policy EVENT IDLE_COUNT`.
   Persist the returned count in task context and immediately apply its action
   and interval to this scheduled task. This resets productive work to 15
   minutes, backs idle work off to 60 minutes, and pauses after three idle
   passes.
7. Treat credentials, permissions, dirty unrelated worktrees, escalations, and
   other playbook stop conditions as `blocked`; pause and report them.

Build and review require separate chats and separate scheduled tasks so their
state cannot mix. If the user requests both, schedule the current lane only and
tell them to invoke this skill in a second chat for the other lane.

Never schedule the interactive spec lane. Never merge, enable auto-merge,
force-push, or run more than one builder for the same repository.
