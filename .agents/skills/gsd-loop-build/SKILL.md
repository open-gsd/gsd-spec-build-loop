---
name: gsd-loop-build
description: Build the oldest safe gsd:ready GitHub issue or repair one gsd:rework PR. Use when asked to run the gsd-loop builder, work the ready queue, or fix rework. Each invocation completes exactly one pass, then stops.
---

Resolve the repository root with `git rev-parse --show-toplevel`. Use its
`loop/build.md` only when the root identifies itself as the gsd-loop source:
`README.md` starts with `# gsd-loop`, all four files under `loop/` exist, and
`scripts/doctor.sh` plus `scripts/scheduler-policy.sh` exist. Otherwise, read
`playbook.md` beside this `SKILL.md`; global installs bundle that canonical
fallback.

Before executing, resolve `LINKAGE_SYNC` to `scripts/ensure-linkage.mjs` beside
this `SKILL.md`. Pass that absolute path wherever the playbook says
`LINKAGE_SYNC`; installed skills bundle its runtime, so a global `gsd-loop`
command is not required. Execute exactly one pass.
