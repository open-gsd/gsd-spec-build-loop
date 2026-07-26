# gsd-loop — instructions for coding agents

This repository ships three agent-neutral playbooks under `loop/`. They work
with any agent that can run shell commands and the authenticated `gh` CLI
(Codex, Claude Code, Cursor, Gemini CLI, aider, ...).

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

- One pass, then stop. The playbooks are written for external repetition
  (a loop runner, cron, or a shell `while` loop), not for improvising extra
  iterations.
- Never merge, never enable auto-merge, never force-push. Humans own every
  merge.
- The issue is the whole contract: implement only its `O-N` outcomes, treat
  `X-N` exclusions as binding, and escalate with `gsd:escalated` instead of
  guessing.
- Run at most one build loop per repository. The claim lock (issue
  assignee) is cooperative, not atomic.

## Looping

Claude Code users run `/loop /gsd-loop-build` and `/loop /gsd-loop-review`
(thin skills in `.claude/skills/` point at these playbooks). Codex users can
invoke `$gsd-loop-build`, `$gsd-loop-review`, or `$gsd-loop-schedule` from the
repository skills in `.agents/skills/`. Codex CLI and other agents can also loop
externally, e.g.:

```bash
while :; do
  codex exec "Read loop/build.md and execute one pass exactly."
  sleep 900
done
```

Honor the playbooks' idle guidance: when a pass reports an empty queue,
lengthen the interval, and stop the loop after three consecutive idle
passes.

## Prerequisites

- `gh` authenticated with write access to the target repository.
- Required status checks configured on the default branch — the reviewer
  escalates every PR in a repo without required CI, by design.

Verify both with `scripts/doctor.sh [owner/repo]` before the first pass.
