---
name: gsd-loop-review
description: Audit one open PR against its linked issue contract and required CI, then post a gsd-loop verdict and labels. Use when asked to run the reviewer or audit the PR queue. Never merge or push; each invocation completes one pass.
---

Resolve the repository root with `git rev-parse --show-toplevel`. If
`loop/review.md` exists there, read it in full. Otherwise, read `playbook.md`
beside this `SKILL.md`; global installs bundle that fallback. Execute exactly
one pass and treat the selected playbook as canonical.
