"""Validate silver extraction: 100% precision check."""

from __future__ import annotations

import yaml
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent
SILVER = ROOT / "input" / "2-silver" / "books"


def validate_book(book_dir: Path) -> dict:
    manifest = yaml.safe_load((book_dir / "tales.yaml").read_text(encoding="utf-8"))
    tales_dir = book_dir / "tales"
    report = {
        "book_id": manifest["book_id"],
        "declared": manifest["total"],
        "files_found": 0,
        "missing_files": [],
        "empty_files": [],
        "tiny_files": [],
        "slug_collisions": [],
        "atu_coverage": 0,
        "total_bytes": 0,
    }

    slugs = [t["slug"] for t in manifest["tales"]]
    counts = Counter(slugs)
    report["slug_collisions"] = [s for s, c in counts.items() if c > 1]

    for t in manifest["tales"]:
        p = tales_dir / f"{t['slug']}.txt"
        if not p.exists():
            report["missing_files"].append(t["slug"])
            continue
        report["files_found"] += 1
        size = p.stat().st_size
        report["total_bytes"] += size
        if size == 0:
            report["empty_files"].append(t["slug"])
        elif size < 200:
            report["tiny_files"].append((t["slug"], size))
        if t.get("atu"):
            report["atu_coverage"] += 1

    return report


def main():
    print(f"{'book_id':<35} {'declared':>8} {'found':>5} {'bytes':>10} {'ATU':>4} {'issues':<30}")
    print("-" * 105)
    total = Counter()
    for book_dir in sorted(SILVER.iterdir()):
        if not book_dir.is_dir():
            continue
        r = validate_book(book_dir)
        issues = []
        if r["missing_files"]:
            issues.append(f"missing:{len(r['missing_files'])}")
        if r["empty_files"]:
            issues.append(f"empty:{len(r['empty_files'])}")
        if r["tiny_files"]:
            issues.append(f"tiny:{len(r['tiny_files'])}")
        if r["slug_collisions"]:
            issues.append(f"slug-collisions:{len(r['slug_collisions'])}")
        if not issues:
            issues.append("OK")
        print(
            f"{r['book_id']:<35} {r['declared']:>8} {r['files_found']:>5} "
            f"{r['total_bytes']:>10,} {r['atu_coverage']:>4} {' '.join(issues):<30}"
        )
        total["declared"] += r["declared"]
        total["found"] += r["files_found"]
        total["bytes"] += r["total_bytes"]
        total["atu"] += r["atu_coverage"]
        if r["tiny_files"]:
            print(f"  tiny files in {r['book_id']}:")
            for slug, sz in r["tiny_files"]:
                print(f"    {slug}: {sz}B")
        if r["slug_collisions"]:
            print(f"  slug collisions in {r['book_id']}: {r['slug_collisions']}")
    print("-" * 105)
    print(f"{'TOTAL':<35} {total['declared']:>8} {total['found']:>5} {total['bytes']:>10,} {total['atu']:>4}")


if __name__ == "__main__":
    main()
