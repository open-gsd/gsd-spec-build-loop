---
name: gsd-loop-spec
description: Turn a rough idea into a contract-grade GitHub issue for the gsd-loop queue. Use when asked to spec an idea, write a queue-ready issue, or shape work for gsd-loop. Interactive only; never run unattended.
---

Resolve the repository root with `git rev-parse --show-toplevel`. Use its
`loop/spec.md` only when the root identifies itself as the gsd-loop source:
`README.md` starts with `# gsd-loop`, all four files under `loop/` exist, and
`scripts/doctor.sh` plus `scripts/scheduler-policy.sh` exist. Otherwise, read
`playbook.md` beside this `SKILL.md`; global installs bundle that canonical
fallback. Execute exactly one pass.
