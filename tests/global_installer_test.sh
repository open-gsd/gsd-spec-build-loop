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
  test -f "$install_root/.claude/skills/.gsd-loop-$skill.gsd-loop-adapter.json"
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

owned_conversion_root="$TEST_ROOT/owned-conversion"
"$INSTALLER" --home "$owned_conversion_root"
"$INSTALLER" --home "$owned_conversion_root" --adapter-mode copy
for skill in spec build review schedule; do
  adapter="$owned_conversion_root/.claude/skills/gsd-loop-$skill"
  test -d "$adapter"
  test ! -L "$adapter"
  test ! -e "$owned_conversion_root/.claude/skills/.gsd-loop-$skill.gsd-loop-adapter.json"
done

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

user_symlink_root="$TEST_ROOT/user-symlink"
"$INSTALLER" --home "$user_symlink_root" --agents codex
user_symlink="$user_symlink_root/.claude/skills/gsd-loop-build"
mkdir -p "$(dirname "$user_symlink")"
ln -s "$user_symlink_root/.agents/skills/gsd-loop-build" "$user_symlink"
if "$INSTALLER" --home "$user_symlink_root" --adapter-mode copy; then
  echo 'copy mode must not replace an unowned symlink' >&2
  exit 1
fi
test -L "$user_symlink"
[ "$(readlink "$user_symlink")" = "$user_symlink_root/.agents/skills/gsd-loop-build" ]
test ! -e "$user_symlink_root/.claude/skills/.gsd-loop-build.gsd-loop-adapter.json"

INSTALLER="$INSTALLER" TEST_ROOT="$TEST_ROOT" python3 - <<'PY'
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
from unittest import mock

installer_path = Path(os.environ["INSTALLER"])
spec = importlib.util.spec_from_file_location("global_installer", installer_path)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

stage_root = Path(os.environ["TEST_ROOT"]) / "canonical-stage"
canonical_stage_root = stage_root / ".agents" / "skills"

def fail_copy(source, destination, **kwargs):
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "partial").write_text("partial\n")
    raise OSError("copy failed")

with mock.patch.object(installer.shutil, "copytree", side_effect=fail_copy):
    try:
        installer.install_canonical(installer_path.parents[1], canonical_stage_root)
    except OSError:
        pass
    else:
        raise AssertionError("canonical staging failure must be reported")

assert not list(canonical_stage_root.iterdir())

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

original_rename = Path.rename

def fail_stage_rename(path, target):
    if (
        path.name.startswith(".gsd-loop-spec.")
        and ".previous-" not in path.name
        and Path(target).name == "gsd-loop-spec"
    ):
        raise OSError("replacement failed")
    return original_rename(path, target)

with mock.patch.object(Path, "rename", fail_stage_rename):
    try:
        installer.install_claude_adapters(canonical_root, claude_root, "copy")
    except OSError:
        pass
    else:
        raise AssertionError("adapter replacement failure must be reported")

for skill in installer.SKILLS:
    adapter = claude_root / skill
    assert (adapter / "preserve").read_text() == "old adapter\n"

with mock.patch.object(
    installer.tempfile,
    "NamedTemporaryFile",
    side_effect=OSError("marker creation failed"),
):
    try:
        installer.install_claude_adapters(canonical_root, claude_root, "symlink")
    except OSError:
        pass
    else:
        raise AssertionError("marker creation failure must be reported")

for skill in installer.SKILLS:
    adapter = claude_root / skill
    assert not adapter.is_symlink()
    assert (adapter / "preserve").read_text() == "old adapter\n"
    assert not installer.path_exists(installer.adapter_marker(adapter))

removal_root = Path(os.environ["TEST_ROOT"]) / "marker-removal"
removal_canonical_root = removal_root / ".agents" / "skills"
removal_claude_root = removal_root / ".claude" / "skills"
for skill in installer.SKILLS:
    canonical = removal_canonical_root / skill
    canonical.mkdir(parents=True)
    (canonical / "SKILL.md").write_text("canonical\n")

installer.install_claude_adapters(removal_canonical_root, removal_claude_root, "symlink")
failed_marker = installer.adapter_marker(removal_claude_root / installer.SKILLS[0])
original_remove_path = installer.remove_path

def fail_marker_remove(path):
    if path == failed_marker:
        raise OSError("marker removal failed")
    return original_remove_path(path)

def fail_marker_rename(path, target):
    if path == failed_marker:
        raise OSError("marker removal failed")
    return original_rename(path, target)

with (
    mock.patch.object(installer, "remove_path", fail_marker_remove),
    mock.patch.object(Path, "rename", fail_marker_rename),
):
    try:
        installer.install_claude_adapters(removal_canonical_root, removal_claude_root, "copy")
    except OSError:
        pass
    else:
        raise AssertionError("marker removal failure must be reported")

for skill in installer.SKILLS:
    adapter = removal_claude_root / skill
    assert adapter.is_symlink()
    assert installer.adapter_marker(adapter).is_file()

cleanup_root = Path(os.environ["TEST_ROOT"]) / "backup-cleanup"
cleanup_canonical_root = cleanup_root / ".agents" / "skills"
cleanup_claude_root = cleanup_root / ".claude" / "skills"
for skill in installer.SKILLS:
    canonical = cleanup_canonical_root / skill
    canonical.mkdir(parents=True)
    (canonical / "SKILL.md").write_text("canonical\n")

installer.install_claude_adapters(cleanup_canonical_root, cleanup_claude_root, "symlink")
cleanup_marker = installer.adapter_marker(cleanup_claude_root / installer.SKILLS[0])
cleanup_backup_prefix = f".{cleanup_marker.name}.previous-"

def fail_marker_backup_cleanup(path):
    if path.name.startswith(cleanup_backup_prefix):
        raise OSError("backup cleanup failed")
    return original_remove_path(path)

warnings = io.StringIO()
with (
    mock.patch.object(installer, "remove_path", fail_marker_backup_cleanup),
    contextlib.redirect_stderr(warnings),
):
    installer.install_claude_adapters(cleanup_canonical_root, cleanup_claude_root, "copy")

assert "warning: could not remove backup" in warnings.getvalue()
for skill in installer.SKILLS:
    adapter = cleanup_claude_root / skill
    assert not adapter.is_symlink()
    assert adapter.is_dir()
    assert not installer.path_exists(installer.adapter_marker(adapter))
PY
