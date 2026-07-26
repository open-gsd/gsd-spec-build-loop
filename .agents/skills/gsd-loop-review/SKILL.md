---
name: gsd-loop-review
description: Audit one open PR against its linked issue contract and required CI, then post a gsd-loop verdict and labels. Use when asked to run the reviewer or audit the PR queue. Never merge or push; each invocation completes one pass.
---

Resolve the repository root with `git rev-parse --show-toplevel`. Use its
`loop/review.md` only when the root identifies itself as the gsd-loop source:
`README.md` starts with `# gsd-loop`, all three files under `loop/` exist, and
`scripts/doctor.sh` plus `scripts/scheduler-policy.sh` exist. Otherwise, read
`playbook.md` beside this `SKILL.md`; global installs bundle that canonical
fallback. Execute exactly one pass.
