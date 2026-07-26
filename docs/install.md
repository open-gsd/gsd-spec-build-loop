# Install and initialize gsd-loop

`@opengsd/gsd-loop` provides one native Node.js CLI for skill installation,
repository setup, readiness checks, and portable loop execution. It runs on
macOS, Linux, and native Windows; WSL is optional, not required.

## Support matrix

| Agent application | Skills | Portable runner |
|---|---|---|
| [Codex](https://developers.openai.com/codex/skills/) | `~/.agents/skills` | Supported |
| [Cursor](https://cursor.com/docs/skills) | `~/.agents/skills` | Supported |
| [Gemini CLI](https://geminicli.com/docs/cli/creating-skills/) | `~/.agents/skills` | Supported |
| [Claude Code](https://code.claude.com/docs/en/skills) | `~/.claude/skills` adapter | Supported |
| [Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) | `~/.agents/skills` | Interactive only |

Codex, Cursor, Gemini, and Kimi share the Agent Skills directory. Claude uses
symlinks to the canonical skills when supported and safe copies otherwise.
Installing a skill does not install, authenticate, or choose a model.

Kimi documents a non-interactive prompt flag but currently prohibits
subscription-based non-interactive automation. The installer therefore keeps
Kimi skill support while the portable runner refuses Kimi explicitly.

## Prerequisites

- Node.js 18 or newer, including `npm` and `npx`.
- Git with a configured author name and email.
- The [`gh` CLI](https://cli.github.com/) authenticated with push access.
- One authenticated Codex, Claude Code, Cursor, or Gemini CLI for unattended
  build/review lanes.

The repository must eventually have a real successful CI check. gsd-loop can
require an existing check, but it does not invent an always-green workflow.

## Recommended onboarding

Run this inside an existing GitHub worktree:

```bash
npx @opengsd/gsd-loop@latest init
```

The command discovers the repository and installed agent CLIs, previews every
planned change, and asks once before it:

- installs or updates all four self-contained skills;
- verifies GitHub and agent authentication;
- creates the five `gsd:*` labels without replacing existing labels;
- writes non-secret runner configuration, locks, and logs beneath Git's common
  directory;
- excludes `.claude/scheduled_tasks.lock` through the local Git exclude file;
- creates or updates only the dedicated `gsd-loop required CI` ruleset.

If no successful CI check exists yet, setup exits with status `3` after making
the build lane ready. Add CI through the first spec/build issue, wait for it to
run successfully, then rerun `init` before starting the reviewer.

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
  --visibility private \
  --runner codex
```

`--yes` never implies `--create-repo`. Automatic creation is limited to an
empty, non-Git directory.

### Choose CI or agent explicitly

When several successful checks or runner CLIs exist, interactive setup asks
which one to use. Unattended setup must disambiguate them:

```bash
npx @opengsd/gsd-loop@latest init --yes \
  --runner claude \
  --required-check test
```

Supported runner names are `codex`, `claude`, `cursor`, and `gemini`. The
preview displays the exact autonomous command and permission flags before
consent. Configuration contains no tokens or credentials.

## Run the loop

Use separate terminals for build and review:

```bash
npx @opengsd/gsd-loop@latest run build
npx @opengsd/gsd-loop@latest run review
```

Use `--once` for a single headless pass or a host-native scheduler:

```bash
npx @opengsd/gsd-loop@latest run build --once
```

One process owns one lane. A live duplicate build lock, active Claude loop
lock, missing required CI for review, malformed agent result, credentials, or
other playbook stop condition pauses the runner instead of guessing. `Ctrl-C`
is forwarded to the active agent and removes the local lock.

The default policy is 15 minutes after work, 60 minutes after idle, and a clean
stop after three consecutive idle passes. The process is foreground-only and
does not survive closing its terminal. `$gsd-loop-schedule` remains available
as an optional adapter on hosts with native recurring tasks.

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
operational failure, `2` is invalid usage, and `3` means setup or execution is
safely waiting for human action.

## Install skills only

Use `install` when repository setup is not wanted:

```bash
npx @opengsd/gsd-loop@latest install --dry-run
npx @opengsd/gsd-loop@latest install
```

Select hosts or Claude adapter behavior when necessary:

```bash
npx @opengsd/gsd-loop@latest install --agents codex,cursor,gemini,kimi
npx @opengsd/gsd-loop@latest install --adapter-mode copy
```

Reinstallation updates only paths marked as installer-owned. A conflicting
unowned skill path stops the entire preflight before anything is replaced.
Use `--home PATH` only for an alternate user profile or isolated test root.

The Python source-checkout installer remains a skill-only fallback when Node
is unavailable:

```bash
python3 scripts/install-global.py --dry-run
python3 scripts/install-global.py
```

## Troubleshooting

- **A skill is not visible:** start a new agent session. Gemini can run
  `/skills reload`; Cursor users should update the CLI and reopen the chat.
- **Agent authentication probe fails:** authenticate that agent CLI directly,
  verify one ordinary prompt succeeds, then rerun `init`.
- **Review remains blocked:** allow CI to complete successfully, rerun `init`,
  and select the check when prompted.
- **A duplicate runner is reported:** stop the existing process. Delete a lock
  only after confirming its recorded PID is no longer running; stale portable
  locks are recovered automatically.
- **Claude symlink creation fails:** rerun with `--adapter-mode copy`.
- **The installer refuses a path:** preserve and inspect it. gsd-loop never
  overwrites an unowned destination.
