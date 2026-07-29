#!/usr/bin/env python3
"""Install self-contained gsd-loop skills into user-level skill directories."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path


SKILLS = (
    "gsd-loop-discover",
    "gsd-loop-spec",
    "gsd-loop-build",
    "gsd-loop-review",
    "gsd-loop-schedule",
)
SUPPORTED_AGENTS = frozenset(("codex", "claude", "cursor", "gemini", "grok", "kimi"))
MARKER = ".gsd-loop-install.json"
MARKER_CONTENT = {"installer": "gsd-loop", "format": 1}
ADAPTER_MARKER_SUFFIX = ".gsd-loop-adapter.json"
ADAPTER_MARKER_CONTENT = {"installer": "gsd-loop", "format": 1, "adapter": "symlink"}
ADAPTER_ROOTS = {
    "claude": ("Claude", ".claude"),
    "cursor": ("Cursor", ".cursor"),
    "gemini": ("Gemini", ".gemini"),
    "grok": ("Grok", ".grok"),
}


def parse_agents(value: str) -> frozenset[str]:
    requested = {agent.strip().lower() for agent in value.split(",") if agent.strip()}
    if not requested or requested == {"all"}:
        return SUPPORTED_AGENTS

    unknown = requested - SUPPORTED_AGENTS
    if unknown:
        names = ", ".join(sorted(unknown))
        raise argparse.ArgumentTypeError(f"unsupported agent(s): {names}")
    return frozenset(requested)


def marker_matches(path: Path, content: dict[str, object]) -> bool:
    if path.is_symlink() or not path.is_file():
        return False
    try:
        return json.loads(path.read_text()) == content
    except (OSError, json.JSONDecodeError):
        return False


def is_owned_directory(path: Path) -> bool:
    return not path.is_symlink() and path.is_dir() and marker_matches(
        path / MARKER, MARKER_CONTENT
    )


def path_exists(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def adapter_marker(destination: Path) -> Path:
    return destination.with_name(f".{destination.name}{ADAPTER_MARKER_SUFFIX}")


def is_owned_adapter(destination: Path, canonical: Path) -> bool:
    return (
        destination.is_symlink()
        and destination.resolve() == canonical.resolve()
        and marker_matches(adapter_marker(destination), ADAPTER_MARKER_CONTENT)
    )


def roots_alias(first: Path, second: Path) -> bool:
    return first.resolve() == second.resolve()


def blocking_directory_component(path: Path) -> Path | None:
    for component in reversed((path, *path.parents)):
        if not path_exists(component):
            return None
        if not component.is_dir():
            return component
    return None


def preflight_adapter_root(
    canonical_root: Path, adapter_root: Path, adapter_mode: str
) -> list[Path]:
    conflicts: list[Path] = []
    blocking_component = blocking_directory_component(adapter_root)
    if blocking_component is not None:
        return [blocking_component]
    if roots_alias(canonical_root, adapter_root):
        return conflicts

    for skill in SKILLS:
        destination = adapter_root / skill
        canonical = canonical_root / skill
        marker = adapter_marker(destination)
        owned_adapter = is_owned_adapter(destination, canonical)
        if path_exists(marker) and not owned_adapter:
            conflicts.append(marker)
        if not path_exists(destination):
            continue
        if (
            destination.is_symlink()
            and destination.resolve() == canonical.resolve()
            and (adapter_mode != "copy" or owned_adapter)
        ):
            continue
        if not is_owned_directory(destination):
            conflicts.append(destination)
    return conflicts


def preflight(
    canonical_root: Path,
    adapter_roots: list[Path],
    adapter_mode: str,
) -> list[Path]:
    conflicts: list[Path] = []
    blocking_component = blocking_directory_component(canonical_root)
    if blocking_component is not None:
        conflicts.append(blocking_component)
    else:
        for skill in SKILLS:
            destination = canonical_root / skill
            if path_exists(destination) and not is_owned_directory(destination):
                conflicts.append(destination)

    for adapter_root in adapter_roots:
        conflicts.extend(
            preflight_adapter_root(canonical_root, adapter_root, adapter_mode)
        )
    return conflicts


def remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def stage_skill(source_root: Path, destination: Path, skill: str) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{skill}.", dir=destination.parent))

    try:
        shutil.copytree(source_root / ".agents" / "skills" / skill, stage, dirs_exist_ok=True)

        lane = skill.removeprefix("gsd-loop-")
        if lane in {"discover", "spec", "build", "review"}:
            shutil.copy2(source_root / "loop" / f"{lane}.md", stage / "playbook.md")
            if lane in {"discover", "spec"}:
                runtime = stage / "scripts" / "runtime"
                runtime.mkdir(parents=True, exist_ok=True)
                for module in (
                    "discovery-map.mjs",
                    "discovery-protocol.mjs",
                    "errors.mjs",
                    "process.mjs",
                ):
                    shutil.copy2(source_root / "lib" / module, runtime / module)
            elif lane == "build":
                runtime = stage / "scripts" / "runtime"
                runtime.mkdir(parents=True, exist_ok=True)
                for module in ("errors.mjs", "linkage.mjs", "process.mjs"):
                    shutil.copy2(source_root / "lib" / module, runtime / module)
            elif lane == "review":
                runtime = stage / "scripts" / "runtime"
                runtime.mkdir(parents=True, exist_ok=True)
                for module in ("audit-evidence.mjs", "errors.mjs", "outcomes.mjs", "process.mjs"):
                    shutil.copy2(source_root / "lib" / module, runtime / module)
        elif lane == "schedule":
            scripts = stage / "scripts"
            scripts.mkdir(exist_ok=True)
            for script in ("doctor.sh", "scheduler-policy.sh"):
                shutil.copy2(source_root / "scripts" / script, scripts / script)

        (stage / MARKER).write_text(json.dumps(MARKER_CONTENT, sort_keys=True) + "\n")
        return stage
    except Exception:
        remove_path(stage)
        raise


def move_to_backup(path: Path) -> Path | None:
    if not path_exists(path):
        return None
    backup = Path(tempfile.mkdtemp(prefix=f".{path.name}.previous-", dir=path.parent))
    backup.rmdir()
    path.rename(backup)
    return backup


def cleanup_backup(path: Path) -> None:
    try:
        remove_path(path)
    except OSError as error:
        print(f"warning: could not remove backup {path}: {error}", file=sys.stderr)


def replace_path(stage: Path, destination: Path) -> None:
    backup = move_to_backup(destination)
    try:
        stage.rename(destination)
    except Exception:
        if backup is not None:
            backup.rename(destination)
        raise
    if backup is not None:
        cleanup_backup(backup)


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


def stage_adapter_marker(destination: Path) -> Path:
    marker = adapter_marker(destination)
    stage: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            prefix=f".{marker.name}.",
            dir=marker.parent,
            delete=False,
        ) as temporary:
            stage = Path(temporary.name)
            json.dump(ADAPTER_MARKER_CONTENT, temporary, sort_keys=True)
            temporary.write("\n")
        return stage
    except Exception:
        if stage is not None and path_exists(stage):
            remove_path(stage)
        raise


def replace_adapter(stage: Path, destination: Path) -> None:
    marker = adapter_marker(destination)
    marker_stage = stage_adapter_marker(destination) if stage.is_symlink() else None
    destination_backup: Path | None = None
    marker_backup: Path | None = None
    destination_installed = False

    try:
        destination_backup = move_to_backup(destination)
        marker_backup = move_to_backup(marker)
        stage.rename(destination)
        destination_installed = True
        if marker_stage is not None:
            marker_stage.rename(marker)
    except Exception:
        if destination_installed:
            remove_path(destination)
        if marker_backup is not None:
            marker_backup.rename(marker)
        if destination_backup is not None:
            destination_backup.rename(destination)
        raise
    else:
        if marker_backup is not None:
            cleanup_backup(marker_backup)
        if destination_backup is not None:
            cleanup_backup(destination_backup)
    finally:
        if marker_stage is not None and path_exists(marker_stage):
            remove_path(marker_stage)


def install_adapters(canonical_root: Path, adapter_root: Path, mode: str) -> None:
    if roots_alias(canonical_root, adapter_root):
        return

    adapter_root.mkdir(parents=True, exist_ok=True)
    for skill in SKILLS:
        canonical = canonical_root / skill
        destination = adapter_root / skill
        if destination.is_symlink() and destination.resolve() == canonical.resolve() and mode != "copy":
            continue

        stage = stage_adapter(canonical, destination, mode)
        try:
            replace_adapter(stage, destination)
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
        help="comma-separated agents: codex,claude,cursor,gemini,grok,kimi (default: all)",
    )
    parser.add_argument(
        "--adapter-mode",
        choices=("auto", "symlink", "copy"),
        default="auto",
        help="how to create native host adapters (default: auto)",
    )
    parser.add_argument("--dry-run", action="store_true", help="show destinations without writing")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    source_root = Path(__file__).resolve().parents[1]
    home = args.home.expanduser().resolve()
    canonical_root = home / ".agents" / "skills"
    adapter_roots = [
        (label, home / directory / "skills")
        for agent, (label, directory) in ADAPTER_ROOTS.items()
        if agent in args.agents
    ]

    conflicts = preflight(
        canonical_root,
        [root for _, root in adapter_roots],
        args.adapter_mode,
    )
    if conflicts:
        for conflict in conflicts:
            print(f"refusing to overwrite unowned path: {conflict}", file=sys.stderr)
        return 1

    print(f"canonical skills: {canonical_root}")
    for label, root in adapter_roots:
        print(f"{label} adapters: {root} ({args.adapter_mode})")
    print(f"agents: {', '.join(sorted(args.agents))}")
    if args.dry_run:
        print("dry run; no files written")
        return 0

    install_canonical(source_root, canonical_root)
    for _, root in adapter_roots:
        install_adapters(canonical_root, root, args.adapter_mode)
    print(f"installed {len(SKILLS)} gsd-loop skills")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
