# Installing gsd-loop globally

The installer makes the four gsd-loop skills available across repositories. It
installs skills for agent applications, not models. A model selected inside
Codex uses Codex's skill discovery; the same model selected inside Cursor uses
Cursor's discovery.

## Is this the right installer?

Use this installer for an auditable, user-level setup across the supported
agent applications below. It keeps one canonical copy, bundles every runtime
resource, preserves paths it does not own, and can be run again safely for
updates.

It is not a universal agent package manager. An application outside the support
matrix must document support for `~/.agents/skills` or needs its own adapter.
For marketplace or organization-wide distribution, package the skills using
the target application's plugin or extension system instead.

## Support matrix

The canonical installation is the shared Agent Skills directory. Claude Code
uses an adapter because its documented personal-skill directory is different.

| Agent application | Installed location | Status |
|---|---|---|
| [Codex](https://developers.openai.com/codex/skills/) | `~/.agents/skills` | Supported |
| [Cursor](https://cursor.com/docs/skills) | `~/.agents/skills` | Supported; open a new chat after installation |
| [Gemini CLI](https://geminicli.com/docs/cli/creating-skills/) | `~/.agents/skills` | Supported |
| [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) | `~/.agents/skills` | Supported |
| [Claude Code](https://code.claude.com/docs/en/skills) | `~/.claude/skills` | Supported through symlinks or copy fallback |
| Other Agent Skills hosts | `~/.agents/skills` when the host scans it | Compatible when documented by that host; not guaranteed |

Cursor documents `~/.agents/skills` as a global location, but skill listing and
slash-menu behavior have varied between Cursor IDE and CLI releases. Update
Cursor and start a new chat if an installed skill is not listed; automatic
invocation may work even when an older slash menu does not show it.

The `--agents` option names supported hosts, but it is not an access-control
list. Codex, Cursor, Gemini, and Kimi share the same canonical directory, so a
skill installed for one is visible to any other host that scans that directory.

## Operating systems

| Environment | Support | Notes |
|---|---|---|
| macOS | Supported | Use Node.js 18+, Bash, Git, and the GitHub CLI |
| Linux | Supported | Use Node.js 18+, Bash, Git, and the GitHub CLI |
| Windows with WSL2 | Recommended Windows workflow | Run the npx installer and installed skills inside WSL2 |
| Native Windows/PowerShell | Installer supported; workflow not supported end to end | The Node installer runs natively, but bundled helpers and playbook commands require a POSIX shell |

The packed npm installer is tested on macOS, Linux, and Windows in CI. The full
Bash-based workflow suite runs on Linux. WSL2 provides the expected Linux
toolchain, but is not a separate CI target.

## Prerequisites

- Node.js 18 or newer, including `npm`/`npx`.
- Bash and Git.
- The [`gh` CLI](https://cli.github.com/) authenticated with write access to
  repositories where the build or review loop will run.
- Required status checks configured on a repository's default branch before
  running the reviewer.

The installer does not install these dependencies, an agent application, or a
model. Python 3.9 or newer is required only for the source-checkout fallback.

## Install with npx

Preview the destinations, then install. `npx` downloads a temporary copy of the
package; it does not add gsd-loop to a project or install it globally.

```bash
npx @opengsd/gsd-loop@latest install --dry-run
npx @opengsd/gsd-loop@latest install
```

These commands work in macOS and Linux shells, WSL2, and native PowerShell.
Use WSL2 rather than PowerShell when running the installed workflows until the
remaining Bash helpers and playbook examples are ported.

The default install creates:

```text
~/.agents/skills/
  gsd-loop-spec/
  gsd-loop-build/
  gsd-loop-review/
  gsd-loop-schedule/

~/.claude/skills/
  gsd-loop-spec       -> ~/.agents/skills/gsd-loop-spec
  gsd-loop-build      -> ~/.agents/skills/gsd-loop-build
  gsd-loop-review     -> ~/.agents/skills/gsd-loop-review
  gsd-loop-schedule   -> ~/.agents/skills/gsd-loop-schedule
```

Claude adapters are symlinks when the platform permits them and copies
otherwise. Every canonical skill bundles its playbook or helper scripts, so the
source checkout does not need to be the repository where a skill runs.

Start a new agent session after installation. Codex normally detects changes
automatically; Gemini can refresh with `/skills reload`. Claude Code may require
a restart when its top-level skills directory did not exist at session start.

## Verify the installation

Confirm the four canonical skill entrypoints exist:

```bash
for skill in spec build review schedule; do
  test -f "$HOME/.agents/skills/gsd-loop-$skill/SKILL.md" || exit 1
done
echo "gsd-loop skills installed"
```

Then verify discovery in the agent you use:

- Codex: type `$` in a prompt and look for `gsd-loop-*`, or invoke
  `$gsd-loop-spec`.
- Claude Code: invoke `/gsd-loop-spec`.
- Gemini CLI: run `/skills list` or `/skills reload`.
- Kimi Code CLI: invoke `/skill:gsd-loop-spec`.
- Cursor: start a new chat and check Settings > Rules and Skills, then ask for a
  task matching the skill description.

Before scheduling or running a lane in a repository, check its GitHub setup:

```bash
~/.agents/skills/gsd-loop-schedule/scripts/doctor.sh owner/repo
~/.agents/skills/gsd-loop-schedule/scripts/doctor.sh --review-ready owner/repo
```

## Select agents or adapter behavior

Install the shared canonical skills without Claude adapters:

```bash
npx @opengsd/gsd-loop@latest install --agents codex,cursor,gemini,kimi
```

Install for one named shared-path host:

```bash
npx @opengsd/gsd-loop@latest install --agents gemini
```

Force Claude adapters to be copies instead of symlinks:

```bash
npx @opengsd/gsd-loop@latest install --adapter-mode copy
```

`--adapter-mode auto` is the default: try symlinks first and fall back to
copies. `--adapter-mode symlink` fails rather than falling back when symlinks
are unavailable.

Use `--home PATH` only when installing into an alternate user profile or an
isolated test root. The default is the current user's home directory.

### Source-checkout fallback

If Node.js is unavailable but Python 3.9 or newer is installed, clone the
repository and run the original installer:

```bash
git clone https://github.com/open-gsd/gsd-spec-build-loop.git
cd gsd-spec-build-loop
python3 scripts/install-global.py --dry-run
python3 scripts/install-global.py
```

## Update

Run the latest package again:

```bash
npx @opengsd/gsd-loop@latest install --dry-run
npx @opengsd/gsd-loop@latest install
```

Reinstallation updates only installer-owned paths. If a destination with the
same name is not installer-owned, the installer stops before writing anything.
Review the reported path; do not delete it until you know who owns it.

## Scheduling support

The spec, build, and review skills work on supported shell-capable agent hosts.
The schedule skill additionally requires a native recurring-task capability.
It uses Codex scheduled tasks in the Codex app. On a host without native
recurring tasks, it reports that scheduling is unsupported and does not start a
background shell loop.

## Troubleshooting

### A skill is not visible

Start a new chat or restart the agent application. For Gemini CLI, run
`/skills reload`. For Cursor, update to the latest release and check both its
Skills settings and automatic invocation; older IDE and CLI releases have had
different discovery behavior.

### The installer refuses to overwrite a path

The path is not marked as installer-owned. Preserve it until you have inspected
its contents. Rename it if you want to keep it, then rerun the installer.

### Claude symlink creation fails

Use copy adapters:

```bash
npx @opengsd/gsd-loop@latest install --adapter-mode copy
```

### GitHub checks fail

Authenticate and rerun the doctor:

```bash
gh auth login
~/.agents/skills/gsd-loop-schedule/scripts/doctor.sh owner/repo
```
