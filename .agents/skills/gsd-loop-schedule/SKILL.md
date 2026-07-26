---
name: gsd-loop-schedule
description: Create or update a Codex scheduled task that repeatedly runs one-pass gsd-loop builder or reviewer work. Use when asked to keep the build or review queue running, schedule gsd-loop, or automate repeated passes.
---

Use Codex's native scheduled-task tool. Do not start a shell `while` loop.

1. Resolve the repository root and run `scripts/doctor.sh` before scheduling.
2. Schedule the requested lane: build, review, or both. Default to build when
   the user only says to keep the build running.
3. Attach the task to the current chat so consecutive idle passes remain in
   context. Default to every 15 minutes unless the user gives a cadence.
4. Put the explicit skill invocation in each scheduled prompt:
   `$gsd-loop-build` or `$gsd-loop-review`.
5. Run exactly one playbook pass per wake. Track consecutive idle passes,
   reset the count after any non-idle pass, and pause the scheduled task after
   three consecutive idle passes.
6. Pause and report when credentials, permissions, a dirty unrelated worktree,
   or another playbook stop condition prevents safe progress.

Never schedule the interactive spec lane. Never merge, enable auto-merge,
force-push, or run more than one builder for the same repository.
