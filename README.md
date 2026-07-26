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

## Quick start

From the repository you want gsd-loop to manage:

```bash
npx @opengsd/gsd-loop@latest init
```

`init` previews one plan and asks before it changes anything. It installs or
updates the four global skills, checks Git and GitHub access, creates the five
labels, records local runner state under `.git/gsd-loop`, and configures one
unambiguous required CI check when GitHub supports repository rulesets.

In an empty directory it can also create a private GitHub repository named
after that directory. Unattended setup never guesses this external action:

```bash
npx @opengsd/gsd-loop@latest init --yes \
  --create-repo --repo OWNER/NAME --visibility private --runner codex
```

Next, invoke the interactive spec skill in your agent and add `gsd:ready` to
the issue after reading it:

| Agent | Spec invocation |
|---|---|
| Codex, Cursor, Gemini | `$gsd-loop-spec` |
| Claude Code | `/gsd-loop-spec` |
| Kimi Code | `/skill:gsd-loop-spec` |

Keep the unattended lanes running in separate terminals:

```bash
npx @opengsd/gsd-loop@latest run build
npx @opengsd/gsd-loop@latest run review
```

The foreground runner supports Codex, Claude Code, Cursor, and Gemini CLI. It
runs one fresh agent pass at a time, waits 15 minutes after work, backs off to
60 minutes after idle passes, and exits after three consecutive idle passes.
It pauses on malformed output, credentials, permissions, dirty worktrees,
escalations, or duplicate builders. Its locks and logs live under `.git`, so
they do not dirty the project.

Kimi skills remain available for interactive one-pass use, but the portable
runner does not automate Kimi subscriptions while Kimi's published usage policy
prohibits non-interactive automation.

Direct `$gsd-loop-build`, `/gsd-loop-build`, and reviewer invocations execute
one pass only. Use them for diagnosis, not durable repetition. Hosts with a
native recurring-task feature can instead invoke `$gsd-loop-schedule`; each
wake enters through `gsd-loop run --once`, so native and foreground runners
share the same lock, consent, readiness, and result checks.

The installer and runner are native Node.js programs tested on macOS, Linux,
and Windows. WSL is not required. See the [installation guide](docs/install.md)
for selective installs, unattended flags, the support matrix, and recovery.

## Your four duties

The loop is deliberately incapable of doing these:

1. Apply `gsd:ready` after reading a filed issue — nothing builds without it.
2. Answer `gsd:blocked` questions, then remove the label.
3. Resolve `gsd:escalated` items, then remove the label.
4. Merge. The loop never merges, never enables auto-merge, and treats
   `gsd:approved` as evidence for your decision, not a substitute for it.

## Requirements

- Node.js 18+, Git, and the `gh` CLI authenticated with push access.
- An authenticated Codex, Claude Code, Cursor, or Gemini CLI for portable
  unattended execution. Kimi remains supported interactively.
- **Required status checks configured** on the default branch. The reviewer
  refuses to treat missing CI as green. `init` configures an existing
  successful check when GitHub supports rulesets; it never creates a fake
  always-green workflow.

Check an environment before the first run:

```bash
npx @opengsd/gsd-loop@latest doctor
npx @opengsd/gsd-loop@latest doctor --review-ready
```

After a global installation, invoke the skills from any GitHub worktree; no
project files need to be copied. `gsd-loop install` remains available when only
global skill installation is wanted; `init` is the recommended repository
onboarding command.

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
