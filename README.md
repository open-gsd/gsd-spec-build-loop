# gsd-loop

A human-gated agent work loop for GitHub. Ideas become contract-grade
issues, issues become PRs, PRs get audited verdicts — and every
irreversible step stays human.

The loop is three agent-neutral playbooks in `loop/` that any coding agent
can execute (Codex, Claude Code, Cursor, Gemini CLI, ...) — the only hard
dependency is an authenticated `gh` CLI. Repository skills live in
`.agents/skills/`, with compatibility shims in `.claude/skills/`.

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

In a Codex prompt, invoke the repository skills directly:

```text
$gsd-loop-spec
$gsd-loop-build
$gsd-loop-review
```

### Install globally

The global installer supports Codex, Claude Code, Cursor, Gemini CLI, and Kimi
Code. It installs skills for the agent application; it does not install or
configure a model. No repository clone or global package install is required:

```bash
npx @opengsd/gsd-loop@latest install --dry-run
npx @opengsd/gsd-loop@latest install
```

By default, one self-contained copy goes in `~/.agents/skills`, with Claude
Code adapters in `~/.claude/skills`. Start a new agent session after installing.

The Node installer runs on macOS, Linux, and native Windows. The complete
gsd-loop workflow currently requires a POSIX shell, so use WSL2 on Windows when
running the installed skills. Native PowerShell is not yet an end-to-end
supported runtime.

See the [installation guide](docs/install.md) for prerequisites, the agent and
OS support matrix, selective installs, updates, verification, conflicts, and
troubleshooting.

To keep a lane running on a host with native recurring tasks, ask for
`$gsd-loop-schedule`. In the Codex app, it creates or updates one named
scheduled task for the current repository and chat. Productive passes run every
15 minutes; idle passes back off to 60 minutes; three consecutive idle passes
pause the task. Run build and review in separate chats so each has its own task
and idle count. The computer and app must stay running for local scheduled
work. On a host without native recurring tasks, the skill reports that
scheduling is unsupported instead of starting its own background loop.

Codex CLI or another agent that can `exec` a prompt can loop externally:

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

Check an environment before the first run:

```bash
scripts/doctor.sh [owner/repo]   # defaults to the current directory's repo
scripts/doctor.sh --review-ready # additionally requires protected CI
```

After a global installation, invoke the skills from any GitHub worktree; no
project files need to be copied. For a repository-local setup instead, copy
`loop/` and `AGENTS.md` into it, plus `.agents/skills/` for shared Agent Skills
clients or `.claude/skills/` for Claude Code. The repository skills are thin
pointers at the playbooks. Labels are created automatically on first run.

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
