"""Mechanically apply merge.json operations to produce readable.txt + alternatives.json.

For each canonical/<slug>/merge.json, load the base voice source
(Hunt's text), apply each operation in declared order, write the result
as readable.txt. Then emit a structured alternatives.json registry of
branching paths NOT absorbed in readable.txt — each entry carries a
verbatim fragment of source text.

Operation schema:
    {
      "op": "insert_before" | "insert_after" | "replace" | "delete",
      "anchor": "<exact verbatim substring of the current text>",
      "text":   "<exact verbatim text to insert (or new replacement)>",
      "from":   "<book-id of the text source, for audit only>"
    }

Anchors must match exactly once. The script fails loudly if an anchor is
missing or ambiguous — there is no fuzzy fallback. Decisions without
operations (stylistic, terminological, or no-op) are skipped silently;
their absence simply means readable.txt = source verbatim where they
apply.
"""

from __future__ import annotations

import json
import re
import sys
import textwrap
from pathlib import Path

import yaml


VERSE_INDENT_RE = re.compile(r"^[ \t]{2,}\S")
VERSE_MAX_LINE = 60  # lines this short suggest verse, not prose


def _is_verse_block(lines: list[str]) -> bool:
    real = [ln.rstrip() for ln in lines if ln.strip()]
    if not real:
        return False
    if any(VERSE_INDENT_RE.match(ln) for ln in real):
        return True
    # Heuristic: 2+ consecutive short lines (each ≤ VERSE_MAX_LINE) → verse.
    if len(real) >= 2 and max(len(ln) for ln in real) <= VERSE_MAX_LINE:
        return True
    return False


def reflow(text: str, width: int = 75) -> str:
    """Re-flow prose paragraphs to a uniform width while preserving:
      - blank-line paragraph separators
      - indented blocks (verse / poetry)
      - short-line blocks heuristically detected as verse
    """
    paragraphs = re.split(r"(\n\s*\n)", text)
    out = []
    for para in paragraphs:
        if not para.strip():
            out.append(para)
            continue
        lines = para.split("\n")
        if _is_verse_block(lines):
            out.append(para)
            continue
        joined = " ".join(ln.strip() for ln in lines if ln.strip())
        if not joined:
            out.append(para)
            continue
        # Tidy: no orphan space before sentence-final punctuation.
        joined = re.sub(r"\s+([,;:.!?])", r"\1", joined)
        wrapped = textwrap.fill(joined, width=width, break_long_words=False, break_on_hyphens=False)
        out.append(wrapped)
    return "".join(out)

ROOT = Path(__file__).resolve().parent.parent
SILVER = ROOT / "input" / "2-silver"
CANONICAL = SILVER / "canonical"
BOOKS = SILVER / "books"


def load_source(book_id: str, slug: str) -> str:
    """Find a tale's .txt by book and slug. Slug may differ between books."""
    path = BOOKS / book_id / "tales" / f"{slug}.txt"
    if not path.exists():
        # Try looking it up via the book's manifest
        manifest = yaml.safe_load((BOOKS / book_id / "tales.yaml").read_text(encoding="utf-8"))
        for t in manifest["tales"]:
            if t.get("slug") == slug or t.get("canonical_slug") == slug:
                path = BOOKS / book_id / "tales" / f"{t['slug']}.txt"
                break
    return path.read_text(encoding="utf-8")


def find_anchor(text: str, anchor: str) -> tuple[int, int]:
    """Return (start, end) of unique whitespace- and quote-tolerant match. Raises if 0 or >1 matches."""
    # Treat any run of whitespace in the anchor as \s+, and any apostrophe / quote
    # variant as a character class spanning straight + fancy variants.
    QUOTE_CLASS = r"['’‘]"
    DQUOTE_CLASS = r"[\"“”]"
    tokens = []
    for tok in anchor.split():
        esc = re.escape(tok)
        # re.escape doesn't escape ' or " — they're not regex metacharacters.
        esc = re.sub(r"['’‘]", QUOTE_CLASS, esc)
        esc = re.sub(r'["“”]', DQUOTE_CLASS, esc)
        tokens.append(esc)
    pattern = re.compile(r"\s+".join(tokens))
    matches = list(pattern.finditer(text))
    if not matches:
        raise ValueError(f"anchor not found.\n  anchor (first 80 chars): {anchor[:80]!r}")
    if len(matches) > 1:
        raise ValueError(
            f"anchor matches {len(matches)} times (must be unique).\n"
            f"  anchor (first 80 chars): {anchor[:80]!r}"
        )
    m = matches[0]
    return m.start(), m.end()


def apply_op(text: str, op: dict, slug: str, op_index: int) -> str:
    anchor = op["anchor"]
    kind = op["op"]
    insert = op.get("text", "")

    try:
        start, end = find_anchor(text, anchor)
    except ValueError as e:
        raise ValueError(f"[{slug}] op {op_index}: {e}") from None

    if kind == "insert_before":
        return text[:start] + insert + text[start:]
    if kind == "insert_after":
        return text[:end] + insert + text[end:]
    if kind == "replace":
        return text[:start] + insert + text[end:]
    if kind == "delete":
        return text[:start] + text[end:]
    raise ValueError(f"[{slug}] op {op_index}: unknown op kind {kind!r}")


def process_one(slug_dir: Path) -> dict:
    merge_path = slug_dir / "merge.yaml"
    if not merge_path.exists():
        return {"slug": slug_dir.name, "status": "no-merge"}
    merge = yaml.safe_load(merge_path.read_text(encoding="utf-8"))

    base_book = merge.get("base", {}).get("book") or merge.get("base_voice")
    slug = merge.get("slug") or slug_dir.name

    # Locate the base text in the base book's tales/
    manifest = yaml.safe_load((BOOKS / base_book / "tales.yaml").read_text(encoding="utf-8"))
    base_text = None
    for t in manifest["tales"]:
        candidate_slug = t.get("slug")
        if "khm" in merge and t.get("khm") == merge["khm"] and t.get("khm_variant", False) == merge.get("khm_variant", False):
            base_text = (BOOKS / base_book / "tales" / f"{candidate_slug}.txt").read_text(encoding="utf-8")
            break
        if "legend_number" in merge and t.get("legend_number") == merge["legend_number"]:
            base_text = (BOOKS / base_book / "tales" / f"{candidate_slug}.txt").read_text(encoding="utf-8")
            break
    if base_text is None:
        p = BOOKS / base_book / "tales" / f"{slug}.txt"
        if p.exists():
            base_text = p.read_text(encoding="utf-8")
        else:
            raise FileNotFoundError(f"[{slug}] could not locate base text in {base_book}")

    text = base_text

    ops_applied = 0
    for i, edit in enumerate(merge.get("edits", []) or []):
        op = {
            "op": edit.get("op"),
            "anchor": edit.get("anchor", ""),
            "text": edit.get("text", ""),
            "from": edit.get("from"),
        }
        text = apply_op(text, op, slug, i)
        ops_applied += 1

    if ops_applied > 0:
        text = reflow(text)

    (slug_dir / "canonical.txt").write_text(text, encoding="utf-8")

    return {
        "slug": slug,
        "status": "ok",
        "base_book": base_book,
        "ops_applied": ops_applied,
        "base_word_count": len(base_text.split()),
        "result_word_count": len(text.split()),
    }


def _section_to_where(section: str) -> str:
    """(Legacy helper, retained for branches.yaml builds elsewhere.)"""
    s = section.lower().strip()
    if not s:
        return "middle"
    if any(k in s for k in ("opening", "introduction", "beginning")):
        return "opening"
    if any(k in s for k in ("ending", "wedding", "closure", "finale", "climax",
                            "punishment", "fate", "death", "marriage", "return")):
        return "ending"
    # §N → bucket by number (assume 8-section average)
    m = re.match(r"^[§]?\s*(\d+)", s)
    if m:
        n = int(m.group(1))
        if n <= 2:
            return "opening"
        if n >= 7:
            return "ending"
        return "middle"
    return "middle"


def main(target: str | None = None) -> None:
    targets = [CANONICAL / target] if target else sorted(CANONICAL.iterdir())
    results = []
    for slug_dir in targets:
        if not slug_dir.is_dir():
            continue
        try:
            r = process_one(slug_dir)
            results.append(r)
            if r.get("status") != "ok":
                continue
            delta = r["result_word_count"] - r["base_word_count"]
            sign = "+" if delta >= 0 else ""
            print(f"  {r['slug']:<40} ops={r['ops_applied']:>2}  words {r['base_word_count']} → {r['result_word_count']} ({sign}{delta})")
        except Exception as e:
            print(f"  {slug_dir.name:<40} ERROR: {e}")
    print(f"\nProcessed {len(results)} canonicals.")


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    main(arg)
