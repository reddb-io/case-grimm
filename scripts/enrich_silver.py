"""Final silver enrichment pass.

For each tale in each book's manifest:
- Add `word_count` (computed from the .txt file).
- Add `char_count`.
- Add `language` (inherited from the book).
- For non-Hunt books: add `title_de` (inherited from Hunt where KHM matches).

Then generate `2-silver/clusters.json` aggregating all variants by KHM, plus
an aggregated alias list and per-cluster canonical pointer.
"""

from __future__ import annotations

from pathlib import Path
from collections import defaultdict

import yaml

ROOT = Path(__file__).resolve().parent.parent
SILVER = ROOT / "input" / "2-silver"
SILVER_BOOKS = SILVER / "books"
BOOKS_YAML = SILVER / "books.yaml"
HUNT_ID = "pg5314-grimm-hunt"


def load_books_meta() -> dict[str, dict]:
    data = yaml.safe_load(BOOKS_YAML.read_text(encoding="utf-8"))
    return {b["id"]: b for b in data["books"]}


def load_manifest(book_id: str) -> dict:
    return yaml.safe_load((SILVER_BOOKS / book_id / "tales.yaml").read_text(encoding="utf-8"))


def save_manifest(book_id: str, data: dict) -> None:
    (SILVER_BOOKS / book_id / "tales.yaml").write_text(
        yaml.dump(data, sort_keys=False, allow_unicode=True, width=1000), encoding="utf-8"
    )


def word_count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8").split())


def char_count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8"))


def enrich_book(book_id: str, language: str, hunt_by_khm: dict[int, dict]) -> None:
    data = load_manifest(book_id)
    tales_dir = SILVER_BOOKS / book_id / "tales"
    for t in data["tales"]:
        txt_path = tales_dir / f"{t['slug']}.txt"
        if txt_path.exists():
            t["word_count"] = word_count(txt_path)
            t["char_count"] = char_count(txt_path)
        t["language"] = language
        # Inherit German title from Hunt when KHM matches and not already present.
        if "title_de" not in t and t.get("khm") in hunt_by_khm and not t.get("khm_variant"):
            ht = hunt_by_khm[t["khm"]]
            if ht.get("title_de"):
                t["title_de"] = ht["title_de"]
    save_manifest(book_id, data)


def generate_clusters(books_meta: dict[str, dict]) -> None:
    hunt = load_manifest(HUNT_ID)
    hunt_by_khm: dict[int, dict] = {}
    for t in hunt["tales"]:
        if t["kind"] == "tale" and not t.get("khm_variant"):
            hunt_by_khm[t["khm"]] = t

    # KHM -> variant list
    clusters: dict[str, dict] = {}

    def cluster_key(khm: int, variant: bool = False) -> str:
        return f"khm-{khm:03d}" + ("-variant" if variant else "")

    # Seed clusters from Hunt (canonical).
    for t in hunt["tales"]:
        if t["kind"] != "tale":
            continue
        ckey = cluster_key(t["khm"], t.get("khm_variant", False))
        clusters[ckey] = {
            "khm": t["khm"],
            "khm_variant": t.get("khm_variant", False),
            "atu": t.get("atu"),
            "canonical_title_en": t["title"],
            "canonical_title_de": t.get("title_de"),
            "canonical_slug": t["slug"],
            "canonical_book": HUNT_ID,
            "aliases": set(),
            "variants": [],
            "languages": set(),
        }

    # Seed legend clusters from Hunt (no KHM, use legend_number).
    for t in hunt["tales"]:
        if t["kind"] != "legend":
            continue
        ckey = f"legend-{t['legend_number']:02d}"
        clusters[ckey] = {
            "legend_number": t["legend_number"],
            "canonical_title_en": t["title"],
            "canonical_title_de": t.get("title_de"),
            "canonical_slug": t["slug"],
            "canonical_book": HUNT_ID,
            "aliases": set(),
            "variants": [],
            "languages": set(),
        }

    # Add every variant (including Hunt itself). Composite entries (one
    # source file that covers multiple KHM numbers) are added to each
    # cluster in `composite_khm` as a `partial` variant.
    for book_id, meta in books_meta.items():
        if meta.get("weight") == "excluded":
            continue
        bdata = load_manifest(book_id)
        for t in bdata["tales"]:
            # Determine target cluster keys (usually one; multiple for composites).
            target_keys: list[tuple[str, bool]] = []  # (cluster_key, is_partial)
            if t.get("kind") == "legend":
                target_keys.append((f"legend-{t['legend_number']:02d}", False))
            elif t.get("khm") is not None:
                primary = cluster_key(t["khm"], t.get("khm_variant", False))
                target_keys.append((primary, False))
                # Composite: also attach to the other KHM clusters as partial.
                for extra_khm in (t.get("composite_khm") or []):
                    if extra_khm == t["khm"]:
                        continue
                    target_keys.append((cluster_key(extra_khm), True))

            for ckey, is_partial in target_keys:
                if ckey not in clusters:
                    continue
                clusters[ckey]["aliases"].add(t["title"])
                clusters[ckey]["languages"].add(meta["language"])
                variant = {
                    "book": book_id,
                    "slug": t["slug"],
                    "title": t["title"],
                    "language": meta["language"],
                    "weight": "canonical" if book_id == HUNT_ID and not is_partial else "supplementary",
                    "word_count": t.get("word_count"),
                    "path": f"books/{book_id}/tales/{t['slug']}.txt",
                }
                if is_partial:
                    variant["partial"] = True
                    variant["note"] = f"Source file covers KHM {t['khm']} + others; this cluster is a sub-tale embedded in it."
                clusters[ckey]["variants"].append(variant)

    # Serialise
    out_clusters = []
    for ckey, c in clusters.items():
        c["cluster_id"] = ckey
        c["aliases"] = sorted(c["aliases"])
        c["languages"] = sorted(c["languages"])
        c["variant_count"] = len(c["variants"])
        out_clusters.append(c)

    # Sort: KHM first, then variants, then legends.
    def sort_key(c):
        if "khm" in c:
            return (0, c["khm"], 1 if c.get("khm_variant") else 0)
        if "legend_number" in c:
            return (1, c["legend_number"], 0)
        return (2, 0, 0)

    out_clusters.sort(key=sort_key)

    payload = {
        "$comment": "Variant clusters keyed by KHM. Canonical reference is Hunt (pg5314).",
        "total_clusters": len(out_clusters),
        "cluster_key": "khm",
        "clusters": out_clusters,
    }
    (SILVER / "clusters.yaml").write_text(
        yaml.dump(payload, sort_keys=False, allow_unicode=True, width=1000), encoding="utf-8"
    )
    return payload


def main():
    meta = load_books_meta()
    hunt = load_manifest(HUNT_ID)
    hunt_by_khm = {t["khm"]: t for t in hunt["tales"] if t["kind"] == "tale" and not t.get("khm_variant")}
    for book_id, m in meta.items():
        if m.get("weight") == "excluded":
            continue
        enrich_book(book_id, m["language"], hunt_by_khm)
        print(f"  enriched {book_id}")
    payload = generate_clusters(meta)
    print(f"  generated clusters.yaml: {payload['total_clusters']} clusters")

    # Quick stats
    multi = [c for c in payload["clusters"] if c["variant_count"] >= 2]
    print(f"  clusters with ≥2 variants: {len(multi)}")
    print(f"  clusters with all 5 books: {sum(1 for c in payload['clusters'] if c['variant_count'] == 5)}")


if __name__ == "__main__":
    main()
