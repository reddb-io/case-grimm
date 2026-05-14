"""Process singleton clusters (KHM present only in Hunt).

For each cluster with exactly one variant, create canonical/<slug>/ with
canonical.txt (Hunt verbatim), merge.yaml (empty build manifest), and
branches.yaml (empty sections list). Nothing to merge for these.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SILVER = ROOT / "input" / "2-silver"
CLUSTERS = SILVER / "clusters.yaml"
CANONICAL = SILVER / "canonical"
BOOKS = SILVER / "books"
HUNT_ID = "pg5314-grimm-hunt"


def make_merge_yaml(cluster: dict) -> dict:
    out = {"slug": cluster["canonical_slug"]}
    if "khm" in cluster:
        out["khm"] = cluster["khm"]
        if cluster.get("khm_variant"):
            out["khm_variant"] = True
    if "legend_number" in cluster:
        out["legend_number"] = cluster["legend_number"]
    out["base"] = {"book": HUNT_ID}
    # No edits — singleton means Hunt verbatim.
    return out


def make_branches_yaml(cluster: dict) -> dict:
    out = {"slug": cluster["canonical_slug"]}
    if "khm" in cluster:
        out["khm"] = cluster["khm"]
    if cluster.get("atu"):
        out["atu"] = cluster["atu"]
    out["base"] = HUNT_ID
    out["sources"] = [{"book": HUNT_ID, "weight": "canonical"}]
    out["sections"] = []  # no analytical sections for a sole-witness cluster
    return out


def main():
    data = yaml.safe_load(CLUSTERS.read_text(encoding="utf-8"))
    singletons = [c for c in data["clusters"] if c["variant_count"] == 1]
    print(f"Found {len(singletons)} singleton clusters.")

    created = 0
    skipped = 0
    for c in singletons:
        slug = c["canonical_slug"]
        out_dir = CANONICAL / slug
        if (out_dir / "merge.yaml").exists():
            skipped += 1
            continue
        out_dir.mkdir(parents=True, exist_ok=True)

        hunt_variant = next((v for v in c["variants"] if v["book"] == HUNT_ID), None)
        if not hunt_variant:
            print(f"  ! no Hunt variant for {slug}, skipping")
            continue
        src = SILVER / hunt_variant["path"]
        shutil.copyfile(src, out_dir / "canonical.txt")

        (out_dir / "merge.yaml").write_text(
            yaml.dump(make_merge_yaml(c), sort_keys=False, allow_unicode=True, width=1000),
            encoding="utf-8",
        )
        (out_dir / "branches.yaml").write_text(
            yaml.dump(make_branches_yaml(c), sort_keys=False, allow_unicode=True, width=1000),
            encoding="utf-8",
        )
        created += 1

    print(f"Created {created} singleton canonicals (skipped {skipped} existing).")


if __name__ == "__main__":
    main()
