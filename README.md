# gsd-loop

A human-gated agent work loop for GitHub. Foggy efforts become decision maps,
clear ideas become contract-grade issues, issues become PRs, and PRs get
audited verdicts — while every irreversible step stays human.

The loop is four agent-neutral playbooks in `loop/` that any coding agent can
execute (Codex, Claude Code, Cursor, Gemini CLI, Grok Build, ...). They use
Node.js and an authenticated `gh` CLI; the installed skills bundle the
deterministic guards their playbooks invoke, so direct one-pass use does not
require a global `gsd-loop` command. The installer keeps canonical skills in
`~/.agents/skills/` and adds native adapters for hosts that use their own
global skill directory.

```
 foggy idea ──discover──▶ decision map ──slices──┐
 clear idea ─────────────────────────────────────┴─▶ spec ─▶ issue(s)
                                                              │ human: gsd:ready each
                                                              ▼
             ┌────────────────────────────── build lane ◀── queue
             ▼
            PR ◀──── fix gsd:rework items ────┐
             │                                │
             ▼                                │
          review lane ── blocking? ── yes ────┘  (3 strikes → gsd:escalated)
             │
             no
             ▼
       gsd:approved ──▶ human merges
```

## The four playbooks

| Playbook | Mode | One pass does |
|---|---|---|
| `loop/discover.md` | interactive | Chart a large uncertain effort, resolve one frontier decision, or re-chart and graduate or stop after the frontier clears |
| `loop/spec.md` | interactive | Interview you about a raw idea, or turn a cleared map's slices into separate GitHub issues with `O-N` outcome / `X-N` exclusion contracts |
| `loop/build.md` | unattended | Repair one `gsd:rework` PR, or claim the oldest safe `gsd:ready` issue and open a PR |
| `loop/review.md` | unattended | Audit one PR against its issue contract and required CI, post a `gsd-loop verdict`, synchronize outcome checkboxes, set labels |

## Label state machine

| Label | Applied by | Cleared by | Meaning |
|---|---|---|---|
| `gsd:map` | discover | map closes after specification | Multi-session planning state; never a build-queue item |
| `gsd:ready` | human | merge (issue closes) | Approved for the build queue |
| `gsd:blocked` | builder | human | One specific question awaits an answer |
| `gsd:rework` | reviewer | builder or reviewer | Verdict has blocking findings |
| `gsd:approved` | reviewer | reviewer on a new head or blocking verdict | Evidence complete and issue outcomes checked; merge is yours |
| `gsd:escalated` | either | human | Out of automation until a human resolves it |

## Quick start

Install the five skills at any time, including before you create or connect a
GitHub repository:

```bash
npx @opengsd/gsd-loop@latest install
```

Skill installation does not require a GitHub repository or an authenticated
`gh` CLI. Once the repository is on GitHub, run its bootstrap from the local
checkout:

```bash
npx @opengsd/gsd-loop@latest init
```

`init` is the combined convenience path: it previews one plan and asks before
it changes anything. It installs or updates the five global skills, checks Git
and GitHub access and review readiness, creates the queue/review labels, and can
configure an existing successful CI check as required when the GitHub plan and
repository permissions support rulesets. It does not choose, launch, or
configure an agent harness.

Start a new harness session after bootstrap. All ongoing work runs as skills
inside that harness:

| Agent | Discover | Spec | Build one pass | Review one pass | Schedule |
|---|---|---|---|---|---|
| Codex | `$gsd-loop-discover` | `$gsd-loop-spec` | `$gsd-loop-build` | `$gsd-loop-review` | `$gsd-loop-schedule` |
| Claude Code | `/gsd-loop-discover` | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Cursor | `/gsd-loop-discover` | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Gemini CLI | `Use the gsd-loop-discover skill` | `Use the gsd-loop-spec skill` | `Use the gsd-loop-build skill` | `Use the gsd-loop-review skill` | `Use the gsd-loop-schedule skill` |
| Grok Build | `/gsd-loop-discover` | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Kimi Code | `/skill:gsd-loop-discover` | `/skill:gsd-loop-spec` | `/skill:gsd-loop-build` | `/skill:gsd-loop-review` | `/skill:gsd-loop-schedule` |

Use discover only when an effort is too large and uncertain to specify. Each
invocation charts a map or performs one bounded advance with you present. An
advance resolves at most one decision; after the frontier clears, it may
instead re-chart and graduate or stop. Once the map is clear, it records one or
more delivery slices; spec files each slice as its own issue. For an already
clear idea, start with spec directly. Read every filed issue and add
`gsd:ready` individually. Build processes those issues over bounded passes.
Build and review belong in separate harness sessions so their state cannot mix.

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
  existing successful check when the GitHub plan and repository permissions
  support rulesets; it never creates a fake always-green workflow. See the
  [installation guide](docs/install.md) for plan and permission limitations.

The bootstrap reports missing prerequisites or review protections before the
first skill run. After it finishes, invoke the skills from any GitHub worktree;
no project files need to be copied. Advanced selective installation,
unattended bootstrap, diagnostics, and recovery are documented in the
[installation guide](docs/install.md).

## Maintainer releases

Releases use GitHub Actions trusted publishing rather than a stored npm token.
One `main`-only workflow publishes npm and creates the matching GitHub Release.
See the [release guide](https://github.com/open-gsd/gsd-spec-build-loop/blob/main/docs/releasing.md)
for the exact publisher settings and procedure.

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
- **Maps absorb uncertainty before contracts.** Discovery maps hold a durable
  destination, decision history, unresolved fog, explicit scope boundary, and
  delivery slices. They never enter the ready queue; spec turns each cleared
  slice into its own contract-grade issue.
- **One writer per map.** Discovery decisions advance serially within a map
  because GitHub issue-body updates are not conditional. This trades
  Wayfinder-style parallel frontier work for recoverable, inspectable state;
  separate maps may still advance independently.
