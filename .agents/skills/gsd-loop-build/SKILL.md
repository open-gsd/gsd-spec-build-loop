---
name: gsd-loop-build
description: Build the oldest safe gsd:ready GitHub issue or repair one gsd:rework PR. Use when asked to run the gsd-loop builder, work the ready queue, or fix rework. Each invocation completes exactly one pass, then stops.
---

Resolve the repository root with `git rev-parse --show-toplevel`, read
`loop/build.md` there in full, and execute exactly one pass. Treat that
playbook as canonical; this skill is only the Codex entry point.
