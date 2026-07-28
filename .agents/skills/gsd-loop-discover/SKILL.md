---
name: gsd-loop-discover
description: Chart or advance one interactive discovery map, shape it into one or more delivery slices, then hand those slices to gsd-loop-spec. Never runs unattended or writes product code.
---

Resolve the repository root with `git rev-parse --show-toplevel`. Use its
`loop/discover.md` only when the root identifies itself as the gsd-loop source:
`README.md` starts with `# gsd-loop`, all four files under `loop/` exist, and
`scripts/doctor.sh` plus `scripts/scheduler-policy.sh` exist. Otherwise, read
`playbook.md` beside this `SKILL.md`; global installs bundle that canonical
fallback. Execute exactly one interactive pass.

When the playbook names `MAP_VALIDATOR`, resolve it to
`scripts/validate-discovery-map.mjs` beside this `SKILL.md`.
