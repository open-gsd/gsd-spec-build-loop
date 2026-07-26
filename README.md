# gsd-loop

A human-gated agent work loop for GitHub, packaged as three Claude Code
skills. Ideas become contract-grade issues, issues become PRs, PRs get
audited verdicts — and every irreversible step stays human.

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

## The three skills

| Skill | Mode | One pass does |
|---|---|---|
| `/gsd-loop-spec` | interactive | Interview you about a raw idea, then file a GitHub issue with an `O-N` outcome / `X-N` exclusion contract |
| `/gsd-loop-build` | unattended, `/loop` | Repair one `gsd:rework` PR, or claim the oldest safe `gsd:ready` issue and open a PR |
| `/gsd-loop-review` | unattended, `/loop` | Audit one PR against its issue contract and required CI, post a `gsd-loop verdict`, set labels |

## Label state machine

| Label | Applied by | Cleared by | Meaning |
|---|---|---|---|
| `gsd:ready` | human | merge (issue closes) | Approved for the build queue |
| `gsd:blocked` | builder | human | One specific question awaits an answer |
| `gsd:rework` | reviewer | builder | Verdict has blocking findings |
| `gsd:approved` | reviewer | — | Evidence complete; merge is yours |
| `gsd:escalated` | either | human | Out of automation until a human resolves it |

## Running it

Spec interactively, then run the two unattended halves in separate sessions:

```
/gsd-loop-spec            # with you present
/loop /gsd-loop-build     # session 1
/loop /gsd-loop-review    # session 2
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

- [Claude Code](https://claude.com/claude-code) with the `gh` CLI
  authenticated against the target repository.
- **Required status checks configured** on the default branch. The reviewer
  refuses to treat missing CI as green — without required checks, every PR
  escalates to `gsd:escalated`.

The skills live in `.claude/skills/` and load automatically inside this
repo. To use the loop on another repository, copy the three skill
directories into that repo's `.claude/skills/` (or your global
`~/.claude/skills/`). Labels are created automatically on first run.

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
