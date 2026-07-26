---
name: gsd-loop-build
description: Build the oldest safe gsd:ready GitHub issue or repair one gsd:rework PR. Use when asked to run the gsd-loop builder, work the ready queue, or fix rework. Each invocation completes exactly one pass, then stops.
---

Resolve the repository root with `git rev-parse --show-toplevel`. If
`loop/build.md` exists there, read it in full. Otherwise, read `playbook.md`
beside this `SKILL.md`; global installs bundle that fallback. Execute exactly
one pass and treat the selected playbook as canonical.
