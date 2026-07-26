---
name: gsd-loop-schedule
description: Create or update a Codex scheduled task that repeatedly runs one-pass gsd-loop builder or reviewer work. Use when asked to keep the build or review queue running, schedule gsd-loop, or automate repeated passes.
---

Use Codex's native scheduled-task tool. Do not start a shell `while` loop.

1. Resolve the repository root and `owner/repo`. Schedule exactly one lane in
   the current chat: build by default, or review when explicitly requested.
2. Run `scripts/doctor.sh` before build scheduling. Run
   `scripts/doctor.sh --review-ready` before review scheduling. Do not create or
   update a review task when that stricter check fails.
3. Use the deterministic name `gsd-loop LANE — owner/repo`. Inspect existing
   scheduled tasks first. Update an exact match instead of duplicating it. If a
   different active builder targets the same repository, stop and identify it.
4. Attach the task to the current chat, start at 15 minutes, and initialize its
   lane-specific idle count to zero.
5. Put `$gsd-loop-build` or `$gsd-loop-review` in the scheduled prompt. Run
   exactly one playbook pass per wake and classify its result as `work`, `idle`,
   or `blocked`.
6. After each pass, run `scripts/scheduler-policy.sh EVENT IDLE_COUNT`. Persist
   the returned count in task context and immediately apply its action and
   interval to this scheduled task. This resets productive work to 15 minutes,
   backs idle work off to 60 minutes, and pauses after three idle passes.
7. Treat credentials, permissions, dirty unrelated worktrees, escalations, and
   other playbook stop conditions as `blocked`; pause and report them.

Build and review require separate chats and separate scheduled tasks so their
state cannot mix. If the user requests both, schedule the current lane only and
tell them to invoke this skill in a second chat for the other lane.

Never schedule the interactive spec lane. Never merge, enable auto-merge,
force-push, or run more than one builder for the same repository.
