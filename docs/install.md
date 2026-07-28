# Install and initialize gsd-loop

`@opengsd/gsd-loop` installs four Agent Skills and provides deterministic
repository setup and readiness checks. The package never launches an agent;
spec, build, review, and scheduling all run inside the harness the user opened.

## Support matrix

| Agent application | Skill location | Invocation |
|---|---|---|
| [Codex](https://developers.openai.com/codex/skills/) | `~/.agents/skills` | `$gsd-loop-*` |
| [Claude Code](https://code.claude.com/docs/en/skills) | `~/.claude/skills` adapter | `/gsd-loop-*` |
| [Cursor](https://cursor.com/docs/skills) | `~/.cursor/skills` adapter | `/gsd-loop-*` |
| [Gemini CLI](https://geminicli.com/docs/cli/creating-skills/) | `~/.gemini/skills` adapter | Natural-language request |
| [Grok Build](https://docs.x.ai/build/features/skills-plugins-marketplaces) | `~/.grok/skills` adapter | `/gsd-loop-*` |
| [Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) | `~/.agents/skills` | `/skill:gsd-loop-*` |

`~/.agents/skills` is the canonical source for Codex and Kimi. Claude, Cursor,
Gemini, and Grok use symlinks from their native global directories when
supported and safe copies otherwise. Installing a skill does not install,
authenticate, select, or launch a model or agent application.

## Prerequisites

- Node.js 18 or newer, including `npm` and `npx`.
- Git with a configured author name and email.
- The [`gh` CLI](https://cli.github.com/) authenticated with push access.
- One supported agent harness with shell access.

The repository must eventually have a real successful CI check. gsd-loop can
require an existing check, but it does not invent an always-green workflow.

## Recommended onboarding

Run this inside an existing GitHub worktree:

```bash
npx @opengsd/gsd-loop@latest init
```

`init` previews every planned change and asks once before it:

- installs or updates all four skills;
- verifies GitHub access;
- creates the five `gsd:*` labels without replacing existing labels;
- locally excludes `.gsd/scheduled_tasks.lock` so native scheduling cannot make
  the worktree look dirty to a builder pass;
- when one successful check is selected, creates or updates only the dedicated
  `gsd-loop required CI` ruleset.

It does not detect an agent CLI, request autonomous permissions, write runner
configuration, or start background work.

If review is not already protected and no successful CI check exists yet,
setup exits with status `3` after making the build lane ready. Add CI through
the first spec/build issue, wait for it to run successfully, then rerun `init`
before starting the reviewer.

GitHub repository plans do not all expose rulesets for private repositories.
When GitHub rejects the dedicated ruleset, `init` keeps the build lane ready,
leaves review blocked, and reports the account/repository limitation. It never
rewrites unrelated branch protection.

### Start from an empty directory

Interactive `init` offers a private repository named after the directory. It
creates `main` with one empty initial commit, so no project files are staged or
invented.

For unattended setup, repository creation requires every external choice:

```bash
npx @opengsd/gsd-loop@latest init --yes \
  --create-repo \
  --repo OWNER/NAME \
  --visibility private
```

In native Windows PowerShell:

```powershell
npx @opengsd/gsd-loop@latest init --yes `
  --create-repo `
  --repo OWNER/NAME `
  --visibility private
```

The equivalent Command Prompt command is:

```bat
npx @opengsd/gsd-loop@latest init --yes --create-repo --repo OWNER/NAME --visibility private
```

`--yes` never implies `--create-repo`. Automatic creation is limited to an
empty, non-Git directory.

### Choose CI explicitly

When several successful checks exist, interactive setup asks which one to
require. Unattended setup must identify it:

```bash
npx @opengsd/gsd-loop@latest init --yes --required-check test
```

## Run skills inside the harness

Start a new harness session after installation. Invoke one skill per pass:

| Agent | Spec | Build | Review | Schedule |
|---|---|---|---|---|
| Codex | `$gsd-loop-spec` | `$gsd-loop-build` | `$gsd-loop-review` | `$gsd-loop-schedule` |
| Claude Code | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Cursor | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Gemini CLI | `Use the gsd-loop-spec skill` | `Use the gsd-loop-build skill` | `Use the gsd-loop-review skill` | `Use the gsd-loop-schedule skill` |
| Grok Build | `/gsd-loop-spec` | `/gsd-loop-build` | `/gsd-loop-review` | `/gsd-loop-schedule` |
| Kimi Code | `/skill:gsd-loop-spec` | `/skill:gsd-loop-build` | `/skill:gsd-loop-review` | `/skill:gsd-loop-schedule` |

Spec is interactive. Build and review are unattended-safe but deliberately
bounded: each invocation performs one unit of work and stops. Keep build and
review in separate sessions.

### Keep a lane running

On a harness with native recurring tasks, invoke the scheduling skill using the
syntax above in the build session, then invoke it separately in the review
session. The scheduling skill creates a native task whose prompt invokes the
lane skill using that same host's syntax. It never shells out to a second agent
CLI.

Productive passes repeat after 15 minutes, idle passes back off to 60 minutes,
and the task pauses after three consecutive idle passes. Credentials,
permissions, malformed output, dirty unrelated worktrees, and escalations pause
the task instead of guessing.

If a host has no native recurring-task facility, the scheduling skill reports
that limitation. Run another one-pass skill invocation when you want another
pass; gsd-loop does not create a foreground daemon or launch a separate agent.

## Readiness checks

Human-readable checks:

```bash
npx @opengsd/gsd-loop@latest doctor
npx @opengsd/gsd-loop@latest doctor --review-ready
```

Machine-readable output:

```bash
npx @opengsd/gsd-loop@latest doctor --json --repo OWNER/NAME
```

Exit status `0` means the requested readiness level passed, `1` is an
operational failure, `2` is invalid usage, and `3` means setup is safely waiting
for human action.

## Install skills only

Use `install` when repository setup is not wanted:

```bash
npx @opengsd/gsd-loop@latest install --dry-run
npx @opengsd/gsd-loop@latest install
```

Select which hosts receive native adapters or choose adapter behavior when
necessary:

```bash
npx @opengsd/gsd-loop@latest install --agents codex,cursor,gemini,grok,kimi
npx @opengsd/gsd-loop@latest install --adapter-mode copy
```

The canonical four-skill bundle is always installed because every adapter
references it and Codex and Kimi use it directly. `--agents` limits the native
adapter directories added for Claude, Cursor, Gemini, and Grok.

Before writing, the installer preflights the canonical bundle and every
selected adapter destination. A conflicting unowned path stops the installation
before anything is replaced. Each replacement is staged beside its destination
and restores that destination from its backup if the replacement fails.
Use `--home PATH` only for an alternate user profile or isolated test root.

On native Windows, the canonical skill directory is
`%USERPROFILE%\.agents\skills`. Claude, Cursor, Gemini, and Grok adapters are
installed under `%USERPROFILE%\.claude\skills`,
`%USERPROFILE%\.cursor\skills`, `%USERPROFILE%\.gemini\skills`, and
`%USERPROFILE%\.grok\skills`.
PowerShell users can preview an alternate profile without WSL:

```powershell
npx @opengsd/gsd-loop@latest install --dry-run --home "$env:USERPROFILE\gsd-loop-profile"
```

The Python source-checkout installer remains a skill-only fallback when Node is
unavailable:

```bash
python3 scripts/install-global.py --dry-run
python3 scripts/install-global.py
```

## Troubleshooting

- **Upgrading from `0.2.3`:** rerun `init` with version `0.2.4` to install the
  build linkage guard and locally exclude `.gsd/scheduled_tasks.lock`. Use
  `install` instead only when repository setup is not wanted.
- **Upgrading from `0.2.2`:** rerun `init` or `install` with version `0.2.3` so
  review outcome synchronization recognizes the repository identity returned
  by the `gh` CLI for linked issues.
- **Upgrading from `0.2.1`:** rerun `init` or `install` with version `0.2.3` to
  add the native Cursor and Gemini adapters. Existing canonical and Claude
  installs remain installer-owned and update safely.
- **Upgrading from `0.2.0`:** stop any old `npx ... run build|review`
  processes. Version `0.2.3` ignores their `.git/gsd-loop` state; remove that
  directory only after confirming no old runner process is active.
- **A skill is not visible:** start a new agent session. Gemini can run
  `/skills reload`; Grok can inspect `/skills`; Cursor users should update the
  CLI and reopen the chat.
- **Review remains blocked:** allow CI to complete successfully, rerun `init`,
  and select the check when prompted.
- **Native scheduling is unavailable:** run the build or review skill manually
  for another bounded pass. Do not substitute an external agent launcher.
- **Native adapter symlink creation fails:** rerun with
  `--adapter-mode copy`.
- **The installer refuses a path:** preserve and inspect it. gsd-loop never
  overwrites an unowned destination.
