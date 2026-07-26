# gsd-loop

A human-gated agent work loop for GitHub. Ideas become contract-grade
issues, issues become PRs, PRs get audited verdicts — and every
irreversible step stays human.

The loop is three agent-neutral playbooks in `loop/` that any coding agent
can execute (Codex, Claude Code, Cursor, Gemini CLI, ...) — the only hard
dependency is an authenticated `gh` CLI. Claude Code gets slash-command
shims in `.claude/skills/`; every other agent routes through `AGENTS.md`.

```
 idea ──/gsd-loop-spec──▶ issue ──human: gsd:ready──▶ queue
                                                        │
              ┌──────────── /gsd-loop-build (loop) ◀────┘
              ▼
             PR ◀──── fix gsd:rework items ────┐
              │                                │
              ▼                                │
   /gsd-loop-review (loop) ── blocking? ── yes ┘  (3 strikes → gsd:escalated)
              │
              no
              ▼
        gsd:approved ──▶ human merges
```

## The three playbooks

| Playbook | Mode | One pass does |
|---|---|---|
| `loop/spec.md` | interactive | Interview you about a raw idea, then file a GitHub issue with an `O-N` outcome / `X-N` exclusion contract |
| `loop/build.md` | unattended | Repair one `gsd:rework` PR, or claim the oldest safe `gsd:ready` issue and open a PR |
| `loop/review.md` | unattended | Audit one PR against its issue contract and required CI, post a `gsd-loop verdict`, set labels |

## Label state machine

| Label | Applied by | Cleared by | Meaning |
|---|---|---|---|
| `gsd:ready` | human | merge (issue closes) | Approved for the build queue |
| `gsd:blocked` | builder | human | One specific question awaits an answer |
| `gsd:rework` | reviewer | builder | Verdict has blocking findings |
| `gsd:approved` | reviewer | — | Evidence complete; merge is yours |
| `gsd:escalated` | either | human | Out of automation until a human resolves it |

## Running it

Spec interactively, then run the two unattended halves in separate sessions.

With Claude Code:

```
/gsd-loop-spec            # with you present
/loop /gsd-loop-build     # session 1
/loop /gsd-loop-review    # session 2
```

With Codex (or any agent that can `exec` a prompt), loop externally:

```bash
codex "Read loop/spec.md and run the interview with me."   # with you present

while :; do   # session 1; same shape with loop/review.md for session 2
  codex exec "Read loop/build.md and execute one pass exactly."
  sleep 900
done
```

Sharing one GitHub token across both loops is safe — the reviewer only
comments and labels. Run at most one builder loop per repository; the claim
lock (issue assignee) is cooperative, not atomic.

## Your four duties

The loop is deliberately incapable of doing these:

1. Apply `gsd:ready` after reading a filed issue — nothing builds without it.
2. Answer `gsd:blocked` questions, then remove the label.
3. Resolve `gsd:escalated` items, then remove the label.
4. Merge. The loop never merges, never enables auto-merge, and treats
   `gsd:approved` as evidence for your decision, not a substitute for it.

## Requirements

- Any coding agent that can run shell commands, plus the `gh` CLI
  authenticated against the target repository.
- **Required status checks configured** on the default branch. The reviewer
  refuses to treat missing CI as green — without required checks, every PR
  escalates to `gsd:escalated`.

To use the loop on another repository, copy `loop/` and `AGENTS.md` into it
(plus `.claude/skills/` if you use Claude Code — the skills are thin
pointers at the playbooks). Labels are created automatically on first run.

## Design notes

- **One SHA, one verdict.** Verdict comments open with
  `gsd-loop verdict for <sha>`; a commit is never re-audited, and crashed
  passes repair labels from the existing verdict instead of re-reviewing.
- **Crash-anywhere recovery.** The builder reconstructs state from git and
  GitHub (dirty trees, orphaned `gsd/NNN-*` branches, stale claims) rather
  than from memory, so a pass can die on any line without wedging the queue.
- **Three strikes.** Three blocking verdicts on distinct SHAs — counted
  since the last human-cleared escalation — route the PR to `gsd:escalated`
  instead of looping forever.
- **Contracts bind both sides.** The builder implements only `O-N` outcomes;
  the reviewer audits only against them; `X-N` exclusions fence both. If it
  isn't in the issue, it doesn't exist.
- **Idle back-off.** Empty queues push the loop to its longest interval and,
  after three idle passes, recommend stopping — new work only appears when
  a human files, unblocks, or merges.
