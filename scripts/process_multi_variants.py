"""Auto-stub canonical/<slug>/ for multi-variant clusters where Hunt is
the longest (or close to longest) witness.

For each cluster with variant_count >= 2 that isn't already processed,
create a stub canonical directory:
- canonical.txt = base witness verbatim
- merge.yaml = base + no edits[]
- branches.yaml = sources + empty sections[]

Skip clusters that are already processed (have a merge.yaml).
Skip clusters where Hunt is shorter than another variant by >= threshold
words — those are flagged for full merge analysis instead of stubbing.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SILVER = ROOT / "input" / "2-silver"
CANONICAL = SILVER / "canonical"
BOOKS_DIR = SILVER / "books"
CLUSTERS = SILVER / "clusters.yaml"

HUNT_ID = "pg5314-grimm-hunt"
TRUNCATION_THRESHOLD = 100  # words shorter than longest → mark for full analysis


def make_merge_yaml(cluster: dict, base_book: str) -> dict:
    out = {"slug": cluster["canonical_slug"]}
    if "khm" in cluster:
        out["khm"] = cluster["khm"]
        if cluster.get("khm_variant"):
            out["khm_variant"] = True
    if "legend_number" in cluster:
        out["legend_number"] = cluster["legend_number"]
    out["base"] = {"book": base_book}
    # No edits — stub awaits manual audit.
    return out


def make_branches_yaml(cluster: dict, base_book: str) -> dict:
    out = {"slug": cluster["canonical_slug"]}
    if "khm" in cluster:
        out["khm"] = cluster["khm"]
    if cluster.get("atu"):
        out["atu"] = cluster["atu"]
    out["base"] = base_book
    out["sources"] = [
        {
            "book": v["book"],
            "weight": "canonical" if v["book"] == base_book else "supplementary",
            "word_count": v.get("word_count"),
        }
        for v in cluster["variants"]
    ]
    out["sections"] = []  # awaits manual audit
    out["status"] = "stub-multi-variant"
    return out


def main():
    data = yaml.safe_load(CLUSTERS.read_text(encoding="utf-8"))
    multi = [c for c in data["clusters"] if c["variant_count"] >= 2]

    created = 0
    skipped_existing = 0
    flagged_for_audit = []

    for c in multi:
        slug = c["canonical_slug"]
        out_dir = CANONICAL / slug
        if (out_dir / "merge.yaml").exists():
            skipped_existing += 1
            continue

        hunt_v = next((v for v in c["variants"] if v["book"] == HUNT_ID), None)
        if hunt_v and hunt_v.get("word_count"):
            others = [v for v in c["variants"] if v["book"] != HUNT_ID and v.get("word_count")]
            if others:
                longest_other = max(others, key=lambda v: v["word_count"])
                if longest_other["word_count"] - hunt_v["word_count"] >= TRUNCATION_THRESHOLD:
                    flagged_for_audit.append({
                        "slug": slug,
                        "khm": c.get("khm"),
                        "title": c["canonical_title_en"],
                        "hunt_words": hunt_v["word_count"],
                        "longest_book": longest_other["book"],
                        "longest_words": longest_other["word_count"],
                        "delta": longest_other["word_count"] - hunt_v["word_count"],
                    })
                    continue

        if not hunt_v:
            base = max(c["variants"], key=lambda v: v.get("word_count") or 0)
            base_book = base["book"]
            base_path = SILVER / base["path"]
        else:
            base_book = HUNT_ID
            base_path = SILVER / hunt_v["path"]

        out_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(base_path, out_dir / "canonical.txt")

        (out_dir / "merge.yaml").write_text(
            yaml.dump(make_merge_yaml(c, base_book), sort_keys=False, allow_unicode=True, width=1000),
            encoding="utf-8",
        )
        (out_dir / "branches.yaml").write_text(
            yaml.dump(make_branches_yaml(c, base_book), sort_keys=False, allow_unicode=True, width=1000),
            encoding="utf-8",
        )
        created += 1

    print(f"Stubbed {created} multi-variant canonicals.")
    print(f"Skipped {skipped_existing} already-processed.")
    print(f"\n{len(flagged_for_audit)} clusters FLAGGED for manual merge audit (Hunt truncates):")
    for f in flagged_for_audit:
        print(f"  KHM {f['khm']:>3}  {f['title']:<40}  Hunt {f['hunt_words']:>4}  vs {f['longest_book'].replace('pg','').replace('-grimm',''):<22} {f['longest_words']:>4}  (+{f['delta']})")

    # Write auto-flagged list to audit-flagged.yaml (machine-derived).
    # audit-needed.yaml is the human-curated resolution log — never overwrite.
    (SILVER / "audit-flagged.yaml").write_text(
        yaml.dump({"flagged_for_audit": flagged_for_audit}, sort_keys=False, allow_unicode=True, width=1000),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
