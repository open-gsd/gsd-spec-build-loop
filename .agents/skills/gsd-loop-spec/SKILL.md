---
name: gsd-loop-spec
description: Turn a rough idea or cleared discovery map into one or more contract-grade GitHub issues for the gsd-loop queue. Interactive only; never run unattended.
---

Resolve the repository root with `git rev-parse --show-toplevel`. Use its
`loop/spec.md` only when the root identifies itself as the gsd-loop source:
`README.md` starts with `# gsd-loop`, all four files under `loop/` exist, and
`scripts/doctor.sh` plus `scripts/scheduler-policy.sh` exist. Otherwise, read
`playbook.md` beside this `SKILL.md`; global installs bundle that canonical
fallback. Execute exactly one pass.

When the playbook names `MAP_VALIDATOR`, resolve it to
`scripts/validate-discovery-map.mjs` beside this `SKILL.md`.
When it names `DISCOVERY_PROTOCOL`, resolve it to
`scripts/manage-discovery.mjs` beside this `SKILL.md`.
