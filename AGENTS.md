# gsd-loop — instructions for coding agents

This repository ships three agent-neutral playbooks under `loop/`. They work
with any agent that can run shell commands, Node.js, and the authenticated `gh`
CLI (Codex, Claude Code, Cursor, Gemini CLI, Grok Build, aider, ...). Installed
skills run these playbooks directly; direct one-pass use does not require a
global `gsd-loop` command.

## Routing

When asked to run a gsd-loop stage, read the matching playbook in full and
execute it exactly:

| Ask | Playbook | Mode |
|---|---|---|
| "spec this idea", "write a queue-ready issue" | `loop/spec.md` | interactive — a human must be present |
| "run the builder", "work the ready queue", "fix rework" | `loop/build.md` | unattended-safe; one pass = one unit of work |
| "run the reviewer", "audit the PR queue" | `loop/review.md` | unattended-safe; one pass = one verdict |
| "keep the build running", "schedule gsd-loop" | `.agents/skills/gsd-loop-schedule/SKILL.md` | schedules bounded recurring passes |

Rules that apply regardless of agent:

- One pass, then stop. The playbooks are written for harness-native repetition,
  not for improvising extra iterations.
- Never merge, never enable auto-merge, never force-push. Humans own every
  merge.
- The issue is the whole product and scope contract: implement only its `O-N`
  outcomes, treat `X-N` exclusions as binding, and escalate with
  `gsd:escalated` instead of guessing.
- Run at most one build loop per repository. The issue assignee is the
  cooperative, cross-host claim and is not atomic.

## Looping

Invoke the installed skills inside the active harness using its native syntax:

| Harness | Spec | Build | Review | Schedule |
|---|---|---|---|---|
| Codex | `$gsd-loop-spec` | `$gsd-loop-build` | `$gsd-loop-review` | `$gsd-loop-schedule` |
| Claude Code | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Cursor | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Gemini CLI | `Use the gsd-loop-spec skill` | `Use the gsd-loop-build skill` | `Use the gsd-loop-review skill` | `Use the gsd-loop-schedule skill` |
| Grok Build | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Kimi Code | `/skill:gsd-loop-spec` | `/skill:gsd-loop-build` | `/skill:gsd-loop-review` | `/skill:gsd-loop-schedule` |

Run the lanes in separate harness sessions. Each direct invocation is one pass.
Use the scheduling skill when the host exposes native recurring tasks so
duplicate-builder, readiness, result, cadence, and idle-stop guardrails remain
active. If the host cannot repeat skills natively, stop after the pass instead
of launching another agent process.

Honor the playbooks' idle guidance: when a pass reports an empty queue,
lengthen the interval, and stop the loop after three consecutive idle
passes.

## Prerequisites

Repository onboarding and readiness checks are owned by the
[README](README.md) and [installation guide](docs/install.md). After bootstrap,
use the installed skill invocations above. The scheduling skill performs its
lane-specific readiness check before creating a task.
