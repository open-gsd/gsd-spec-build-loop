---
name: gsd-loop-review
description: Audit one open PR against its linked issue contract and required CI, then post a gsd-loop verdict and labels. Use when asked to run the reviewer or audit the PR queue. Never merge or push; each invocation completes one pass.
---

Resolve the repository root with `git rev-parse --show-toplevel`, read
`loop/review.md` there in full, and execute exactly one pass. Treat that
playbook as canonical; this skill is only the Codex entry point.
