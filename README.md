# gsd-loop

A human-gated agent work loop for GitHub. Ideas become contract-grade
issues, issues become PRs, PRs get audited verdicts — and every
irreversible step stays human.

The loop is three agent-neutral playbooks in `loop/` that any coding agent can
execute (Codex, Claude Code, Cursor, Gemini CLI, ...). They use Node.js and an
authenticated `gh` CLI; the installed review skill bundles its deterministic
outcome synchronizer, so direct one-pass use does not require a global
`gsd-loop` command. Repository skills live in `.agents/skills/`, with
compatibility shims in `.claude/skills/`.

```
 idea ──spec skill──▶ issue ──human: gsd:ready──▶ queue
                                                  │
              ┌────────────────── build lane ◀────┘
              ▼
             PR ◀──── fix gsd:rework items ────┐
              │                                │
              ▼                                │
           review lane ── blocking? ── yes ┘  (3 strikes → gsd:escalated)
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
| `loop/review.md` | unattended | Audit one PR against its issue contract and required CI, post a `gsd-loop verdict`, synchronize outcome checkboxes, set labels |

## Label state machine

| Label | Applied by | Cleared by | Meaning |
|---|---|---|---|
| `gsd:ready` | human | merge (issue closes) | Approved for the build queue |
| `gsd:blocked` | builder | human | One specific question awaits an answer |
| `gsd:rework` | reviewer | builder or reviewer | Verdict has blocking findings |
| `gsd:approved` | reviewer | reviewer on a new head or blocking verdict | Evidence complete and issue outcomes checked; merge is yours |
| `gsd:escalated` | either | human | Out of automation until a human resolves it |

## Quick start

Run one bootstrap command from the repository you want gsd-loop to manage:

```bash
npx @opengsd/gsd-loop@latest init
```

This is the only user-facing step outside an agent harness. `init` previews one
plan and asks before it changes anything. It installs or updates the four global
skills, checks Git and GitHub access and review readiness, creates the five
labels, and can configure an existing successful CI check as required when
GitHub supports repository rulesets. It does not choose, launch, or configure
an agent harness.

Start a new harness session after bootstrap. All ongoing work runs as skills
inside that harness:

| Agent | Spec | Build one pass | Review one pass | Schedule |
|---|---|---|---|---|
| Codex | `$gsd-loop-spec` | `$gsd-loop-build` | `$gsd-loop-review` | `$gsd-loop-schedule` |
| Claude Code | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Cursor | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Gemini CLI | `Use the gsd-loop-spec skill` | `Use the gsd-loop-build skill` | `Use the gsd-loop-review skill` | `Use the gsd-loop-schedule skill` |
| Kimi Code | `/skill:gsd-loop-spec` | `/skill:gsd-loop-build` | `/skill:gsd-loop-review` | `/skill:gsd-loop-schedule` |

After the spec files an issue, read it and add `gsd:ready`. Build and review
belong in separate harness sessions so their state cannot mix.

Each build or review invocation executes exactly one bounded pass. To keep a
lane running, invoke the scheduling skill inside that lane's session using the
syntax above. The skill uses the harness's native recurring-task facility,
backs idle work off from 15 to 60 minutes, and pauses after three idle passes.
A host without native repetition reports that scheduling is unsupported;
gsd-loop does not launch a second agent process.

The installer and deterministic setup helpers are native Node.js programs
tested on macOS, Linux, and Windows. WSL is not required. See the
[installation guide](docs/install.md) for selective installs, unattended flags,
the support matrix, and recovery.

## Your four duties

The loop is deliberately incapable of doing these:

1. Apply `gsd:ready` after reading a filed issue — nothing builds without it.
2. Answer `gsd:blocked` questions, then remove the label.
3. Resolve `gsd:escalated` items, then remove the label.
4. Merge. The loop never merges, never enables auto-merge, and treats
   `gsd:approved` as evidence for your decision, not a substitute for it.

## Requirements

- Node.js 18+, Git, and the `gh` CLI authenticated with push access.
- A supported agent harness with shell access. Installation does not install,
  authenticate, select, or launch the harness.
- **Required status checks configured** on the default branch before review.
  The reviewer refuses to treat missing CI as green. `init` configures an
  existing successful check when GitHub supports rulesets; it never creates a
  fake always-green workflow.

The bootstrap reports missing prerequisites or review protections before the
first skill run. After it finishes, invoke the skills from any GitHub worktree;
no project files need to be copied. Advanced selective installation,
unattended bootstrap, diagnostics, and recovery are documented in the
[installation guide](docs/install.md).

## Maintainer releases

npm releases use GitHub Actions trusted publishing rather than a stored npm
token. See the [release guide](https://github.com/open-gsd/gsd-spec-build-loop/blob/main/docs/releasing.md)
for the exact npm publisher settings and the manual, `main`-only release
procedure.

## Design notes

- **One head and linked issue, one verdict.** Trusted verdict comments open
  with `gsd-loop verdict for <sha> issue #<number>`; that head-and-issue pair
  is never re-audited, and crashed passes repair issue checkboxes and labels
  from the existing verdict instead. New commits invalidate checked outcomes
  until the new head is independently approved.
- **Crash-anywhere recovery.** The builder reconstructs state from git and
  GitHub (dirty trees, orphaned `gsd/NNN-*` branches, stale claims) rather
  than from memory, so a pass can die on any line without wedging the queue.
- **Three strikes.** Three blocking verdicts on distinct SHAs — counted
  since the last human-cleared escalation — route the PR to `gsd:escalated`
  instead of looping forever.
- **Contracts bind product scope.** The builder implements only `O-N`
  outcomes; the reviewer audits functional behavior against them; `X-N`
  exclusions fence both. Independent required-CI and dependency-security
  gates still apply.
- **Dependency diffs are audited.** Any manifest or lockfile change requires a
  machine-readable baseline-versus-branch advisory comparison. New high or
  critical advisories block approval even when the issue did not ask for a
  security audit.
- **Idle back-off.** Empty queues push the loop to its longest interval. The
  scheduling skill pauses after three idle passes because new work only appears
  when a human files, unblocks, or merges.
