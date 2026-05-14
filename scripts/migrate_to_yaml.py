"""One-time migration: canonical/<slug>/{merge.json, alternatives.json, diff.md}
→ canonical/<slug>/{merge.yaml, branches.yaml}; readable.txt → canonical.txt.

merge.yaml = pure build manifest (base + ordered edits[] operations).
branches.yaml = analytical layer (sections[] with canonical choice +
                 rejected branches with rationale, consequences, plot_breaks).

This script reads the existing merge.json (was decisions.json before its
rename) and reshapes it. Operations[] inside decisions[] are flattened
into a single edits[] list at the top of merge.yaml. The decisions and
their alternatives become sections[] in branches.yaml.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CANONICAL = ROOT / "input" / "2-silver" / "canonical"


# Custom YAML representer: render strings with newlines using block-literal '|'.
class LiteralStr(str):
    pass


def _literal_str_representer(dumper, data):
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")


yaml.add_representer(LiteralStr, _literal_str_representer)


def maybe_block(s: str | None) -> str | LiteralStr | None:
    """Promote any multiline string to YAML block-literal."""
    if s is None:
        return None
    if isinstance(s, str) and "\n" in s:
        # Block-literal needs strings that don't end with stray indentation
        return LiteralStr(s.rstrip() + "\n")
    return s


def short_book(book_id: str) -> str:
    """Compact book id for filenames and labels."""
    return book_id  # keep full id; aliases live in books.json


def section_id_from_decision(decision: dict, idx: int) -> str:
    """Derive a section id from a decision's section label, falling back to its position."""
    section = (decision.get("section") or "").strip()
    if not section:
        return f"sec{idx + 1}"
    # "§1 opening" / "§6 dwarf's mountain song" → opening / dwarf-mountain-song
    s = re.sub(r"^§\s*\d+\s*", "", section).strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or f"sec{idx + 1}"


def section_title_from_decision(decision: dict) -> str:
    section = (decision.get("section") or "").strip()
    if not section:
        return ""
    return re.sub(r"^§\s*\d+\s+", "", section).strip()


def migrate_one(slug_dir: Path) -> dict:
    merge_path = slug_dir / "merge.json"
    if not merge_path.exists():
        return {"slug": slug_dir.name, "status": "skip-no-merge"}
    old = json.loads(merge_path.read_text(encoding="utf-8"))

    slug = old.get("slug") or slug_dir.name
    khm = old.get("khm")
    khm_variant = old.get("khm_variant")
    atu = old.get("atu")
    legend_number = old.get("legend_number")
    base_book = old.get("base_voice", "pg5314-grimm-hunt")
    sources = old.get("sources") or []
    decisions = old.get("decisions") or []

    # ─── merge.yaml: pure build manifest ───────────────────────────
    edits = []
    edit_counter = 1
    for d in decisions:
        for op in (d.get("operations") or []):
            edits.append({
                "id": edit_counter,
                "op": op.get("op"),
                "from": op.get("from"),
                "anchor": maybe_block(op.get("anchor", "")),
                "text": maybe_block(op.get("text", "")),
                "label": d.get("section") or d.get("id") or f"edit {edit_counter}",
            })
            edit_counter += 1

    merge_yaml = {"slug": slug}
    if khm is not None:
        merge_yaml["khm"] = khm
    if khm_variant:
        merge_yaml["khm_variant"] = True
    if legend_number is not None:
        merge_yaml["legend_number"] = legend_number
    merge_yaml["base"] = {"book": base_book}
    if edits:
        merge_yaml["edits"] = edits

    # ─── branches.yaml: analytical layer ───────────────────────────
    sections_out = []
    for i, d in enumerate(decisions):
        sid = section_id_from_decision(d, i)
        stitle = section_title_from_decision(d)
        canonical_block = {
            "kept": " + ".join(d.get("kept_from") or []) or base_book,
            "type": d.get("type", "stylistic"),
        }
        rationale = d.get("rationale") or d.get("applied")
        if rationale:
            canonical_block["rationale"] = maybe_block(rationale.strip())

        branches = []
        # forks come from decisions[].alternatives
        for alt in (d.get("alternatives") or []):
            branches.append({
                "type": "fork",
                "from": alt.get("from"),
                "description": alt.get("description", ""),
                "text": maybe_block(_first_op_text(alt) or ""),
                "consequences": alt.get("consequences", []),
                "plot_breaks": maybe_block(alt.get("plot_breaks", "n/a")),
            })
        # additions come from decisions[].graph_layer_notes
        for note in (d.get("graph_layer_notes") or []):
            branches.append({
                "type": "addition",
                "from": note.get("from"),
                "description": note.get("fact", ""),
                "text": maybe_block(note.get("text", "")),
                "consequences": note.get("consequences", []),
                "plot_breaks": maybe_block(note.get("plot_breaks", "none")),
            })

        # Skip sections with no canonical info AND no branches (pure stylistic stubs).
        if not branches and d.get("type") in (None, "stylistic"):
            continue

        sec = {"id": sid}
        if stitle:
            sec["title"] = stitle
        sec["canonical"] = canonical_block
        if branches:
            sec["branches"] = branches
        sections_out.append(sec)

    branches_yaml = {"slug": slug}
    if khm is not None:
        branches_yaml["khm"] = khm
    if atu is not None:
        branches_yaml["atu"] = atu
    branches_yaml["base"] = base_book
    branches_yaml["sources"] = [
        {"book": s.get("book"), "weight": s.get("weight", "supplementary")}
        for s in sources
    ]
    branches_yaml["sections"] = sections_out

    # ─── Write outputs ─────────────────────────────────────────────
    (slug_dir / "merge.yaml").write_text(
        yaml.dump(merge_yaml, sort_keys=False, allow_unicode=True, width=1000),
        encoding="utf-8",
    )
    (slug_dir / "branches.yaml").write_text(
        yaml.dump(branches_yaml, sort_keys=False, allow_unicode=True, width=1000),
        encoding="utf-8",
    )

    # Rename readable.txt → canonical.txt
    readable = slug_dir / "readable.txt"
    canonical_txt = slug_dir / "canonical.txt"
    if readable.exists() and not canonical_txt.exists():
        readable.rename(canonical_txt)

    # Clean obsolete artifacts
    for stale in ("merge.json", "alternatives.json", "alternatives.txt", "diff.md"):
        p = slug_dir / stale
        if p.exists():
            p.unlink()

    return {
        "slug": slug,
        "status": "ok",
        "edits": len(edits),
        "sections": len(sections_out),
        "branches": sum(len(s.get("branches", [])) for s in sections_out),
    }


def _first_op_text(alt: dict) -> str | None:
    for op in (alt.get("operations") or []):
        if op.get("text"):
            return op["text"]
    return None


def main(target: str | None = None) -> None:
    targets = [CANONICAL / target] if target else sorted(CANONICAL.iterdir())
    ok = 0
    skip = 0
    sums = {"edits": 0, "sections": 0, "branches": 0}
    for d in targets:
        if not d.is_dir():
            continue
        r = migrate_one(d)
        if r["status"] == "ok":
            ok += 1
            sums["edits"] += r["edits"]
            sums["sections"] += r["sections"]
            sums["branches"] += r["branches"]
        else:
            skip += 1
    print(f"Migrated {ok} canonicals (skipped {skip}).")
    print(f"Totals: {sums['edits']} edits, {sums['sections']} sections, {sums['branches']} branches.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
