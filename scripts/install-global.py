#!/usr/bin/env python3
"""Install self-contained gsd-loop skills into user-level skill directories."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path


SKILLS = ("gsd-loop-spec", "gsd-loop-build", "gsd-loop-review", "gsd-loop-schedule")
SUPPORTED_AGENTS = frozenset(("codex", "claude", "cursor", "kimi"))
MARKER = ".gsd-loop-install.json"
MARKER_CONTENT = {"installer": "gsd-loop", "format": 1}


def parse_agents(value: str) -> frozenset[str]:
    requested = {agent.strip().lower() for agent in value.split(",") if agent.strip()}
    if not requested or requested == {"all"}:
        return SUPPORTED_AGENTS

    unknown = requested - SUPPORTED_AGENTS
    if unknown:
        names = ", ".join(sorted(unknown))
        raise argparse.ArgumentTypeError(f"unsupported agent(s): {names}")
    return frozenset(requested)


def is_owned_directory(path: Path) -> bool:
    marker = path / MARKER
    if path.is_symlink() or not path.is_dir() or not marker.is_file():
        return False
    try:
        return json.loads(marker.read_text()) == MARKER_CONTENT
    except (OSError, json.JSONDecodeError):
        return False


def path_exists(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def roots_alias(first: Path, second: Path) -> bool:
    return first.resolve() == second.resolve()


def preflight(canonical_root: Path, claude_root: Path, agents: frozenset[str]) -> list[Path]:
    conflicts: list[Path] = []
    for skill in SKILLS:
        destination = canonical_root / skill
        if path_exists(destination) and not is_owned_directory(destination):
            conflicts.append(destination)

    if "claude" not in agents or roots_alias(canonical_root, claude_root):
        return conflicts

    for skill in SKILLS:
        destination = claude_root / skill
        canonical = canonical_root / skill
        if not path_exists(destination):
            continue
        if destination.is_symlink() and destination.resolve() == canonical.resolve():
            continue
        if not is_owned_directory(destination):
            conflicts.append(destination)
    return conflicts


def stage_skill(source_root: Path, destination: Path, skill: str) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{skill}.", dir=destination.parent))
    shutil.copytree(source_root / ".agents" / "skills" / skill, stage, dirs_exist_ok=True)

    lane = skill.removeprefix("gsd-loop-")
    if lane in {"spec", "build", "review"}:
        shutil.copy2(source_root / "loop" / f"{lane}.md", stage / "playbook.md")
    elif lane == "schedule":
        scripts = stage / "scripts"
        scripts.mkdir(exist_ok=True)
        for script in ("doctor.sh", "scheduler-policy.sh"):
            shutil.copy2(source_root / "scripts" / script, scripts / script)

    (stage / MARKER).write_text(json.dumps(MARKER_CONTENT, sort_keys=True) + "\n")
    return stage


def remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def replace_path(stage: Path, destination: Path) -> None:
    backup: Path | None = None
    if path_exists(destination):
        backup = Path(
            tempfile.mkdtemp(prefix=f".{destination.name}.previous-", dir=destination.parent)
        )
        backup.rmdir()
        destination.rename(backup)
    try:
        stage.rename(destination)
    except Exception:
        if backup is not None:
            backup.rename(destination)
        raise
    if backup is not None:
        remove_path(backup)


def install_canonical(source_root: Path, canonical_root: Path) -> None:
    for skill in SKILLS:
        destination = canonical_root / skill
        stage = stage_skill(source_root, destination, skill)
        try:
            replace_path(stage, destination)
        finally:
            if stage.exists():
                shutil.rmtree(stage)


def stage_adapter(canonical: Path, destination: Path, mode: str) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{destination.name}.", dir=destination.parent))
    stage.rmdir()

    try:
        if mode in {"auto", "symlink"}:
            try:
                stage.symlink_to(canonical, target_is_directory=True)
                return stage
            except OSError:
                if mode == "symlink":
                    raise
        shutil.copytree(canonical, stage)
        return stage
    except Exception:
        if path_exists(stage):
            remove_path(stage)
        raise


def install_claude_adapters(canonical_root: Path, claude_root: Path, mode: str) -> None:
    if roots_alias(canonical_root, claude_root):
        return

    claude_root.mkdir(parents=True, exist_ok=True)
    for skill in SKILLS:
        canonical = canonical_root / skill
        destination = claude_root / skill
        if destination.is_symlink() and destination.resolve() == canonical.resolve() and mode != "copy":
            continue

        stage = stage_adapter(canonical, destination, mode)
        try:
            replace_path(stage, destination)
        finally:
            if path_exists(stage):
                remove_path(stage)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Install global, self-contained gsd-loop skills for supported agents."
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=Path.home(),
        help="user home directory to install beneath (default: current home)",
    )
    parser.add_argument(
        "--agents",
        type=parse_agents,
        default=SUPPORTED_AGENTS,
        help="comma-separated agents: codex,claude,cursor,kimi (default: all)",
    )
    parser.add_argument(
        "--adapter-mode",
        choices=("auto", "symlink", "copy"),
        default="auto",
        help="how to create Claude adapters (default: auto)",
    )
    parser.add_argument("--dry-run", action="store_true", help="show destinations without writing")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    source_root = Path(__file__).resolve().parents[1]
    home = args.home.expanduser().resolve()
    canonical_root = home / ".agents" / "skills"
    claude_root = home / ".claude" / "skills"

    conflicts = preflight(canonical_root, claude_root, args.agents)
    if conflicts:
        for conflict in conflicts:
            print(f"refusing to overwrite unowned path: {conflict}", file=sys.stderr)
        return 1

    print(f"shared skills: {canonical_root}")
    if "claude" in args.agents:
        print(f"Claude adapters: {claude_root} ({args.adapter_mode})")
    print(f"agents: {', '.join(sorted(args.agents))}")
    if args.dry_run:
        print("dry run; no files written")
        return 0

    install_canonical(source_root, canonical_root)
    if "claude" in args.agents:
        install_claude_adapters(canonical_root, claude_root, args.adapter_mode)
    print(f"installed {len(SKILLS)} gsd-loop skills")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
