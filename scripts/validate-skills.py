#!/usr/bin/env python3
import re
import sys
from pathlib import Path

NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FRONTMATTER_PATTERN = re.compile(r"^---\n(?P<body>.*?)\n---(?:\n|$)", re.DOTALL)


def parse_frontmatter(skill_file: Path) -> dict[str, str]:
    match = FRONTMATTER_PATTERN.match(skill_file.read_text())
    if not match:
        raise ValueError("invalid YAML frontmatter")

    values: dict[str, str] = {}
    for line in match.group("body").splitlines():
        key, separator, value = line.partition(":")
        if not separator or not value.strip():
            raise ValueError("frontmatter entries must be non-empty key/value pairs")
        if key in values:
            raise ValueError(f"duplicate frontmatter key: {key}")
        values[key] = value.strip()

    if set(values) != {"name", "description"}:
        raise ValueError("frontmatter must contain only name and description")
    return values


def validate_skill(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    try:
        metadata = parse_frontmatter(skill_dir / "SKILL.md")
    except (OSError, ValueError) as error:
        return [f"{skill_dir}: {error}"]

    name = metadata["name"]
    if not NAME_PATTERN.fullmatch(name):
        errors.append(f"{skill_dir}: invalid skill name: {name}")
    if skill_dir.name != name:
        errors.append(f"{skill_dir}: folder name must match skill name: {name}")
    if len(metadata["description"]) > 1024:
        errors.append(f"{skill_dir}: description exceeds 1024 characters")

    openai_file = skill_dir / "agents" / "openai.yaml"
    try:
        openai_yaml = openai_file.read_text()
    except OSError as error:
        errors.append(f"{openai_file}: {error}")
        return errors

    prompt_match = re.search(r'^\s+default_prompt:\s+"([^"]+)"\s*$', openai_yaml, re.MULTILINE)
    if not prompt_match or f"${name}" not in prompt_match.group(1):
        errors.append(f"{openai_file}: default_prompt must mention ${name}")
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate-skills.py SKILLS_DIRECTORY", file=sys.stderr)
        return 2

    skills_root = Path(sys.argv[1])
    skill_dirs = sorted(path for path in skills_root.iterdir() if path.is_dir())
    if not skill_dirs:
        print(f"{skills_root}: no skill directories found", file=sys.stderr)
        return 1

    errors = [error for skill_dir in skill_dirs for error in validate_skill(skill_dir)]
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    print(f"validated {len(skill_dirs)} skills")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
