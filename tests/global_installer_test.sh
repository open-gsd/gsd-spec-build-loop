#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
INSTALLER="$ROOT/scripts/install-global.py"
TEST_ROOT=$(cd "$(mktemp -d /tmp/gsd-global-installer.XXXXXX)" && pwd -P)
trap 'rm -rf "$TEST_ROOT"' EXIT

install_root="$TEST_ROOT/install"
"$INSTALLER" --home "$install_root"

for skill in spec build review schedule; do
  canonical="$install_root/.agents/skills/gsd-loop-$skill"
  claude="$install_root/.claude/skills/gsd-loop-$skill"
  test -f "$canonical/SKILL.md"
  test -f "$canonical/.gsd-loop-install.json"
  test -L "$claude"
  [ "$(readlink "$claude")" = "$canonical" ]
done

test -f "$install_root/.agents/skills/gsd-loop-build/playbook.md"
test -f "$install_root/.agents/skills/gsd-loop-review/playbook.md"
test -f "$install_root/.agents/skills/gsd-loop-spec/playbook.md"
test -x "$install_root/.agents/skills/gsd-loop-schedule/scripts/doctor.sh"
test -x "$install_root/.agents/skills/gsd-loop-schedule/scripts/scheduler-policy.sh"
"$ROOT/scripts/validate-skills.py" "$install_root/.agents/skills"

"$INSTALLER" --home "$install_root"

dry_root="$TEST_ROOT/dry"
"$INSTALLER" --home "$dry_root" --dry-run
test ! -e "$dry_root"

shared_root="$TEST_ROOT/shared-only"
"$INSTALLER" --home "$shared_root" --agents codex,cursor,kimi
test -d "$shared_root/.agents/skills/gsd-loop-build"
test ! -e "$shared_root/.claude"

copy_root="$TEST_ROOT/copy"
"$INSTALLER" --home "$copy_root" --adapter-mode copy
test -d "$copy_root/.claude/skills/gsd-loop-build"
test ! -L "$copy_root/.claude/skills/gsd-loop-build"

conflict_root="$TEST_ROOT/conflict"
conflict_output="$TEST_ROOT/conflict.out"
mkdir -p "$conflict_root/.agents/skills/gsd-loop-build"
printf 'preserve me\n' > "$conflict_root/.agents/skills/gsd-loop-build/user-file"
if "$INSTALLER" --home "$conflict_root" >"$conflict_output" 2>&1; then
  echo 'an unowned destination must block installation' >&2
  exit 1
fi
grep -q 'refusing to overwrite unowned path' "$conflict_output"
grep -q 'preserve me' "$conflict_root/.agents/skills/gsd-loop-build/user-file"
test ! -e "$conflict_root/.agents/skills/gsd-loop-spec"

claude_conflict_root="$TEST_ROOT/claude-conflict"
claude_conflict_output="$TEST_ROOT/claude-conflict.out"
mkdir -p "$claude_conflict_root/.claude/skills/gsd-loop-review"
printf 'preserve me\n' > "$claude_conflict_root/.claude/skills/gsd-loop-review/user-file"
if "$INSTALLER" --home "$claude_conflict_root" >"$claude_conflict_output" 2>&1; then
  echo 'an unowned Claude destination must block installation' >&2
  exit 1
fi
grep -q 'refusing to overwrite unowned path' "$claude_conflict_output"
grep -q 'preserve me' "$claude_conflict_root/.claude/skills/gsd-loop-review/user-file"
test ! -e "$claude_conflict_root/.agents"

aliased_root="$TEST_ROOT/aliased"
mkdir -p "$aliased_root/.agents/skills" "$aliased_root/.claude"
ln -s "$aliased_root/.agents/skills" "$aliased_root/.claude/skills"
"$INSTALLER" --home "$aliased_root"
for skill in spec build review schedule; do
  canonical="$aliased_root/.agents/skills/gsd-loop-$skill"
  test -d "$canonical"
  test ! -L "$canonical"
  test -f "$canonical/.gsd-loop-install.json"
done

INSTALLER="$INSTALLER" TEST_ROOT="$TEST_ROOT" python3 - <<'PY'
import importlib.util
import json
import os
from pathlib import Path
from unittest import mock

installer_path = Path(os.environ["INSTALLER"])
spec = importlib.util.spec_from_file_location("global_installer", installer_path)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

root = Path(os.environ["TEST_ROOT"]) / "transaction"
canonical_root = root / ".agents" / "skills"
claude_root = root / ".claude" / "skills"
for skill in installer.SKILLS:
    canonical = canonical_root / skill
    adapter = claude_root / skill
    canonical.mkdir(parents=True)
    adapter.mkdir(parents=True)
    (canonical / "SKILL.md").write_text("canonical\n")
    (adapter / installer.MARKER).write_text(json.dumps(installer.MARKER_CONTENT))
    (adapter / "preserve").write_text("old adapter\n")

with (
    mock.patch.object(Path, "symlink_to", side_effect=OSError("symlink unavailable")),
    mock.patch.object(installer.shutil, "copytree", side_effect=OSError("copy failed")),
):
    try:
        installer.install_claude_adapters(canonical_root, claude_root, "auto")
    except OSError:
        pass
    else:
        raise AssertionError("adapter staging failure must be reported")

for skill in installer.SKILLS:
    adapter = claude_root / skill
    assert (adapter / "preserve").read_text() == "old adapter\n"
PY
