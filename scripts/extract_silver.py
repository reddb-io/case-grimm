"""Extract per-tale text and manifest from each bronze book into 2-silver/books/.

Each book has its own TOC format. Functions below are written per-book and
must achieve 100% precision (every TOC entry maps to exactly one body section
and vice versa). Manifest output is `tales.json` per book with `kebab-case`
slugs; tale texts go in `tales/<slug>.txt`.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
BRONZE = ROOT / "input" / "1-bronze"
SILVER_BOOKS = ROOT / "input" / "2-silver" / "books"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers


def slugify(title: str) -> str:
    """Title → kebab-case slug. ASCII-only, no punctuation."""
    # Normalise to ASCII (strip accents, fancy quotes)
    s = unicodedata.normalize("NFKD", title)
    s = s.encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    # Replace anything non-alphanumeric with hyphen
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s


def read_book(name: str) -> list[str]:
    return (BRONZE / name).read_text(encoding="utf-8").splitlines()


def write_book_output(book_id: str, manifest: dict, tales: list[tuple[str, list[str]]]) -> None:
    """Write tales.json + tales/<slug>.txt for one book."""
    out_dir = SILVER_BOOKS / book_id
    tales_dir = out_dir / "tales"
    tales_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "tales.yaml").write_text(
        yaml.dump(manifest, sort_keys=False, allow_unicode=True, width=1000), encoding="utf-8"
    )
    for slug, body_lines in tales:
        # Strip trailing blank lines but keep internal structure
        while body_lines and not body_lines[-1].strip():
            body_lines.pop()
        (tales_dir / f"{slug}.txt").write_text(
            "\n".join(body_lines) + "\n", encoding="utf-8"
        )


def title_key(s: str) -> str:
    """Loose match key for title comparison: lowercase, alphanumeric only."""
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def find_line(lines: list[str], pattern: str, start: int = 0) -> int:
    """Return 0-based index of first line matching `pattern` from `start`."""
    rx = re.compile(pattern)
    for i in range(start, len(lines)):
        if rx.search(lines[i]):
            return i
    raise ValueError(f"Pattern not found: {pattern!r}")


SECTION_HEADERS = {
    "children's legends",
    "children’s legends",
}


def slice_between_headers(
    lines: list[str],
    headers: list[tuple[int, str, str]],  # (line_index, slug, title)
    body_end: int,
) -> list[tuple[str, list[str]]]:
    """Cut body between consecutive header indices. Each tale's body excludes the header line itself.

    Also strips trailing decorative section headers (e.g. "Children's Legends")
    that sit between groups of tales.
    """
    out = []
    for i, (ln, slug, _title) in enumerate(headers):
        next_ln = headers[i + 1][0] if i + 1 < len(headers) else body_end
        body = list(lines[ln + 1 : next_ln])
        # Trim trailing blank lines and decorative section headers from tail
        while body:
            last = body[-1].strip().lower()
            if last == "" or last in SECTION_HEADERS:
                body.pop()
            else:
                break
        out.append((slug, body))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# pg5314 — Margaret Hunt, complete corpus (200 tales + 10 legends)


def extract_hunt() -> None:
    book_id = "pg5314-grimm-hunt"
    lines = read_book("pg5314.txt")

    toc_start = 46  # 0-based: line containing " 1 The Frog King..."
    toc_end = 258  # exclusive: line after "Legend 10 The Hazel Branch"

    toc_entries: list[dict] = []
    toc_tale_rx = re.compile(r"^\s*(\d+)(\*?)\s+(.+?)(?:\s+\(([^)]*)\))?\s*$")
    toc_legend_rx = re.compile(r"^\s*Legend\s+(\d+)\s+(.+?)(?:\s+\(([^)]*)\))?\s*$")

    for ln in lines[toc_start:toc_end]:
        ls = ln.strip()
        if not ls:
            continue
        if ls.startswith("Children"):
            continue
        m = toc_legend_rx.match(ls)
        if m:
            num, title, de = m.groups()
            toc_entries.append(
                {
                    "kind": "legend",
                    "legend_number": int(num),
                    "title": title,
                    "title_de": de,
                }
            )
            continue
        m = toc_tale_rx.match(ls)
        if m:
            num, star, title, de = m.groups()
            toc_entries.append(
                {
                    "kind": "tale",
                    "khm": int(num),
                    "khm_variant": star == "*",
                    "title": title,
                    "title_de": de,
                }
            )

    # Body parsing
    body_start = toc_end  # body begins right after TOC
    body_end_rx = re.compile(r"^\*\*\* END OF THE PROJECT GUTENBERG")
    body_end = find_line(lines, r"^\*\*\* END OF THE PROJECT GUTENBERG", start=body_start)

    headers: list[tuple[int, str, str]] = []

    body_tale_rx = re.compile(r"^(\d+)\*?\s+(.+?)\s*$")
    body_legend_rx = re.compile(r"^Legend\s+(\d+)\s+(.+?)\s*$")

    # Walk body, find headers in order matching TOC
    toc_idx = 0
    for i in range(body_start, body_end):
        ls = lines[i].rstrip()
        if not ls.strip():
            continue
        if toc_idx >= len(toc_entries):
            break
        entry = toc_entries[toc_idx]
        if entry["kind"] == "tale":
            m = body_tale_rx.match(ls)
            if not m:
                continue
            num, title = m.groups()
            if int(num) == entry["khm"]:
                # Slug from TOC title (canonical), not body title — body
                # sometimes has German-first or parenthetical variants.
                slug = slugify(entry["title"])
                headers.append((i, slug, title))
                entry["slug"] = slug
                entry["body_title"] = title
                toc_idx += 1
        else:  # legend
            m = body_legend_rx.match(ls)
            if not m:
                continue
            num, title = m.groups()
            if int(num) == entry["legend_number"]:
                slug = f"legend-{int(num):02d}-{slugify(entry['title'])}"
                headers.append((i, slug, title))
                entry["slug"] = slug
                entry["body_title"] = title
                toc_idx += 1

    assert toc_idx == len(toc_entries), (
        f"Hunt: matched {toc_idx}/{len(toc_entries)} headers — TOC and body diverge"
    )

    tales = slice_between_headers(lines, headers, body_end)

    manifest = {
        "book_id": book_id,
        "source_file": "../../1-bronze/pg5314.txt",
        "total": len(toc_entries),
        "tales": [
            {
                **{k: v for k, v in e.items() if v is not None and k != "kind"},
                "kind": e["kind"],
            }
            for e in toc_entries
        ],
    }
    write_book_output(book_id, manifest, tales)
    print(f"  {book_id}: {len(toc_entries)} tales extracted")


# ─────────────────────────────────────────────────────────────────────────────
# pg2591 — Taylor/Edwardes selection (62 tales, with compound entries)


def extract_taylor() -> None:
    book_id = "pg2591-grimm-taylor"
    lines = read_book("pg2591.txt")

    # TOC: lines 47..114 (0-based 46..113 inclusive, plus filter)
    toc_start = 46
    toc_end = 114

    # Parsed manually from the TOC, including compound entries.
    # Compound: a parent tale + ordered sub-parts. Slug = parent slug.
    TOC_ENTRIES: list[dict] = [
        {"title": "THE GOLDEN BIRD"},
        {"title": "HANS IN LUCK"},
        {"title": "JORINDA AND JORINDEL"},
        {"title": "THE TRAVELLING MUSICIANS"},
        {"title": "OLD SULTAN"},
        {"title": "THE STRAW, THE COAL, AND THE BEAN"},
        {"title": "BRIAR ROSE"},
        {"title": "THE DOG AND THE SPARROW"},
        {"title": "THE TWELVE DANCING PRINCESSES"},
        {"title": "THE FISHERMAN AND HIS WIFE"},
        {"title": "THE WILLOW-WREN AND THE BEAR"},
        {"title": "THE FROG-PRINCE"},
        {"title": "CAT AND MOUSE IN PARTNERSHIP"},
        {"title": "THE GOOSE-GIRL"},
        {
            "title": "THE ADVENTURES OF CHANTICLEER AND PARTLET",
            "parts": [
                "1. HOW THEY WENT TO THE MOUNTAINS TO EAT NUTS",
                "2. HOW CHANTICLEER AND PARTLET WENT TO VISIT MR KORBES",
                "3. HOW PARTLET DIED AND WAS BURIED, AND HOW CHANTICLEER DIED OF GRIEF",
            ],
        },
        {"title": "RAPUNZEL"},
        {"title": "FUNDEVOGEL"},
        {"title": "THE VALIANT LITTLE TAILOR"},
        {"title": "HANSEL AND GRETEL"},
        {"title": "THE MOUSE, THE BIRD, AND THE SAUSAGE"},
        {"title": "MOTHER HOLLE"},
        {"title": "LITTLE RED-CAP [LITTLE RED RIDING HOOD]"},
        {"title": "THE ROBBER BRIDEGROOM"},
        {"title": "TOM THUMB"},
        {"title": "RUMPELSTILTSKIN"},
        {"title": "CLEVER GRETEL"},
        {"title": "THE OLD MAN AND HIS GRANDSON"},
        {"title": "THE LITTLE PEASANT"},
        {"title": "FREDERICK AND CATHERINE"},
        {"title": "SWEETHEART ROLAND"},
        {"title": "SNOWDROP"},
        {"title": "THE PINK"},
        {"title": "CLEVER ELSIE"},
        {"title": "THE MISER IN THE BUSH"},
        {"title": "ASHPUTTEL"},
        {"title": "THE WHITE SNAKE"},
        {"title": "THE WOLF AND THE SEVEN LITTLE KIDS"},
        {"title": "THE QUEEN BEE"},
        {"title": "THE ELVES AND THE SHOEMAKER"},
        {"title": "THE JUNIPER-TREE"},
        {"title": "THE TURNIP"},
        {"title": "CLEVER HANS"},
        {"title": "THE THREE LANGUAGES"},
        {"title": "THE FOX AND THE CAT"},
        {"title": "THE FOUR CLEVER BROTHERS"},
        {"title": "LILY AND THE LION"},
        {"title": "THE FOX AND THE HORSE"},
        {"title": "THE BLUE LIGHT"},
        {"title": "THE RAVEN"},
        {"title": "THE GOLDEN GOOSE"},
        {"title": "THE WATER OF LIFE"},
        {"title": "THE TWELVE HUNTSMEN"},
        {"title": "THE KING OF THE GOLDEN MOUNTAIN"},
        {"title": "DOCTOR KNOWALL"},
        {"title": "THE SEVEN RAVENS"},
        {"title": "THE WEDDING OF MRS FOX", "parts": ["FIRST STORY", "SECOND STORY"]},
        {"title": "THE SALAD"},
        {"title": "THE STORY OF THE YOUTH WHO WENT FORTH TO LEARN WHAT FEAR WAS"},
        {"title": "KING GRISLY-BEARD"},
        {"title": "IRON HANS"},
        {"title": "CAT-SKIN"},
        {"title": "SNOW-WHITE AND ROSE-RED"},
    ]
    assert len(TOC_ENTRIES) == 62

    body_end = find_line(lines, r"^\*\*\* END OF THE PROJECT GUTENBERG")

    # Body starts after "THE BROTHERS GRIMM FAIRY TALES" header
    body_start = find_line(lines, r"^THE BROTHERS GRIMM FAIRY TALES")

    # For each TOC entry, find its title in body (exact match, isolated line).
    headers: list[tuple[int, str, str]] = []
    cursor = body_start
    for e in TOC_ENTRIES:
        title = e["title"]
        slug = slugify(title)
        # Find exact-line match starting from cursor
        idx = None
        target = title_key(title)
        for i in range(cursor, body_end):
            if title_key(lines[i].strip()) == target:
                idx = i
                break
        if idx is None:
            raise RuntimeError(f"Taylor: title not found in body: {title!r}")
        headers.append((idx, slug, title))
        cursor = idx + 1
        e["slug"] = slug
        e["body_line"] = idx + 1  # 1-based

    tales = slice_between_headers(lines, headers, body_end)

    manifest = {
        "book_id": book_id,
        "source_file": "../../1-bronze/pg2591.txt",
        "total": len(TOC_ENTRIES),
        "tales": TOC_ENTRIES,
    }
    write_book_output(book_id, manifest, tales)
    print(f"  {book_id}: {len(TOC_ENTRIES)} tales extracted")


# ─────────────────────────────────────────────────────────────────────────────
# pg11027 — Gruelle illustrated selection (25 tales)


def extract_gruelle() -> None:
    book_id = "pg11027-grimm-gruelle"
    lines = read_book("pg11027.txt")

    # TOC is UPPERCASE list, lines 60..110
    toc_start = 60
    toc_end = 111
    toc_titles = [
        ln.strip() for ln in lines[toc_start:toc_end] if ln.strip() and ln.strip().isupper()
    ]
    assert len(toc_titles) == 25, f"Gruelle TOC has {len(toc_titles)} titles, expected 25"

    body_end = find_line(lines, r"^\*\*\* END OF THE PROJECT GUTENBERG")
    body_start = find_line(lines, r"^\[Illustration: Grimm's Fairy Stories\]")

    headers: list[tuple[int, str, str]] = []
    cursor = body_start
    entries = []
    for title in toc_titles:
        idx = None
        target = title_key(title)
        for i in range(cursor, body_end):
            if title_key(lines[i].strip()) == target:
                idx = i
                break
        if idx is None:
            raise RuntimeError(f"Gruelle: title not found in body: {title!r}")
        slug = slugify(title)
        headers.append((idx, slug, title))
        cursor = idx + 1
        entries.append({"title": title, "slug": slug, "body_line": idx + 1})

    tales = slice_between_headers(lines, headers, body_end)
    manifest = {
        "book_id": book_id,
        "source_file": "../../1-bronze/pg11027.txt",
        "total": len(entries),
        "tales": entries,
    }
    write_book_output(book_id, manifest, tales)
    print(f"  {book_id}: {len(entries)} tales extracted")


# ─────────────────────────────────────────────────────────────────────────────
# pg52521 — Olcott illustrated selection (47 tales)


def extract_olcott() -> None:
    book_id = "pg52521-grimm-olcott"
    lines = read_book("pg52521.txt")

    # TOC: lines 167..268 (0-based). Format `<TITLE>   <page>`.
    toc_start = 167
    toc_end = 270  # stops before ILLUSTRATIONS header

    toc_rx = re.compile(r"^\s+([A-Z][A-Z’',;\-\.\s]+?)\s{2,}\d+\s*$")
    entries = []
    for ln in lines[toc_start:toc_end]:
        m = toc_rx.match(ln)
        if not m:
            continue
        title = m.group(1).strip().rstrip(".")
        entries.append({"title": title, "slug": slugify(title)})

    assert len(entries) == 51, f"Olcott TOC has {len(entries)} titles, expected 51"

    body_end = find_line(lines, r"^\*\*\* END OF THE PROJECT GUTENBERG")
    body_start = find_line(lines, r"^GRIMM[’']S FAIRY TALES\s*$", start=200)

    headers: list[tuple[int, str, str]] = []
    cursor = body_start
    for e in entries:
        title = e["title"]
        idx = None
        target = title_key(title)
        for i in range(cursor, body_end):
            if title_key(lines[i].strip()) == target:
                idx = i
                break
        if idx is None:
            raise RuntimeError(f"Olcott: title not found in body: {title!r}")
        headers.append((idx, e["slug"], title))
        cursor = idx + 1
        e["body_line"] = idx + 1

    tales = slice_between_headers(lines, headers, body_end)
    manifest = {
        "book_id": book_id,
        "source_file": "../../1-bronze/pg52521.txt",
        "total": len(entries),
        "tales": entries,
    }
    write_book_output(book_id, manifest, tales)
    print(f"  {book_id}: {len(entries)} tales extracted")


# ─────────────────────────────────────────────────────────────────────────────
# pg22555 — Dutch (38 tales, Roman numerals)


def extract_dutch() -> None:
    book_id = "pg22555-grimm-eeden-dutch"
    lines = read_book("pg22555.txt")

    # TOC at end: lines ~5935..5977
    toc_start = 5935
    toc_end_marker = find_line(lines, r"^\*\*\* END OF THE PROJECT GUTENBERG", start=toc_start)
    entries = []
    for ln in lines[toc_start:toc_end_marker]:
        ls = ln.strip()
        if not ls or ls.startswith("INHOUD"):
            continue
        # Dutch TOC entries are tab-indented; just title.
        entries.append({"title": ls, "slug": slugify(ls)})

    assert len(entries) == 39, f"Dutch TOC has {len(entries)} titles, expected 39"

    # Body: tale headers are UPPERCASE versions of TOC titles followed by `.`
    # Format: <Roman numeral>. \n <TITLE>.
    body_end = find_line(lines, r"^\*\*\* END OF THE PROJECT GUTENBERG")

    headers: list[tuple[int, str, str]] = []
    cursor = 0
    for e in entries:
        # Build UPPERCASE form, replace fancy chars
        target = title_key(e["title"])
        idx = None
        for i in range(cursor, body_end):
            ls = lines[i].strip().rstrip(".")
            if ls and ls == ls.upper() and title_key(ls) == target:
                idx = i
                break
        if idx is None:
            raise RuntimeError(f"Dutch: title not found in body: {title_upper!r}")
        headers.append((idx, e["slug"], e["title"]))
        cursor = idx + 1
        e["body_line"] = idx + 1

    tales = slice_between_headers(lines, headers, body_end)
    manifest = {
        "book_id": book_id,
        "source_file": "../../1-bronze/pg22555.txt",
        "total": len(entries),
        "tales": entries,
    }
    write_book_output(book_id, manifest, tales)
    print(f"  {book_id}: {len(entries)} tales extracted")


# ─────────────────────────────────────────────────────────────────────────────


def main() -> None:
    SILVER_BOOKS.mkdir(parents=True, exist_ok=True)
    print("Extracting silver/books/...")
    extract_hunt()
    extract_taylor()
    extract_gruelle()
    extract_olcott()
    extract_dutch()
    print("done.")


if __name__ == "__main__":
    main()
