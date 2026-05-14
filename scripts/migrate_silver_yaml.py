"""One-shot migration: silver JSON → YAML.

Converts:
- input/2-silver/books.json          → books.yaml
- input/2-silver/clusters.json       → clusters.yaml
- input/2-silver/audit-needed.json   → audit-needed.yaml
- input/2-silver/books/<id>/tales.json → tales.yaml  (5 books)

Original JSON files are removed after successful conversion.
Multiline strings are written using YAML block literals via a custom
representer (re-used from migrate_to_yaml.py).
"""

from __future__ import annotations

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SILVER = ROOT / "input" / "2-silver"


class LiteralStr(str):
    pass


def _literal_repr(dumper, data):
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")


yaml.add_representer(LiteralStr, _literal_repr)


def maybe_literal(value):
    """Recursively walk a structure, promoting multiline strings to block-literal."""
    if isinstance(value, str) and "\n" in value:
        return LiteralStr(value.rstrip() + "\n")
    if isinstance(value, dict):
        return {k: maybe_literal(v) for k, v in value.items()}
    if isinstance(value, list):
        return [maybe_literal(v) for v in value]
    return value


def convert(json_path: Path, yaml_path: Path, *, delete_json: bool = True) -> None:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    data = maybe_literal(data)
    yaml_path.write_text(
        yaml.dump(data, sort_keys=False, allow_unicode=True, width=1000),
        encoding="utf-8",
    )
    if delete_json:
        json_path.unlink()
    print(f"  {json_path.relative_to(ROOT)} → {yaml_path.name}")


def main() -> None:
    print("Migrating silver JSON → YAML...")

    # Top-level files
    for fname in ("books.json", "clusters.json", "audit-needed.json"):
        jp = SILVER / fname
        if jp.exists():
            convert(jp, jp.with_suffix(".yaml"))

    # Per-book manifests
    books_dir = SILVER / "books"
    if books_dir.exists():
        for book_dir in sorted(books_dir.iterdir()):
            if not book_dir.is_dir():
                continue
            jp = book_dir / "tales.json"
            if jp.exists():
                convert(jp, jp.with_suffix(".yaml"))

    print("Migration complete.")


if __name__ == "__main__":
    main()
