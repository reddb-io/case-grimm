"""Augment Taylor/Gruelle/Olcott/Dutch manifests with KHM + ATU via title matching.

Hunt's KHM table is canonical. For each tale in the other books, we attempt
to match its title to a Hunt KHM number. Direct title matches handle most;
ALIASES handles the well-known re-titlings (Ashputtel=Cinderella, etc.).

Unmatched tales are reported and left without KHM (they will need manual
resolution — possibly genuine variants Hunt does not include, or anchors
of compound entries).
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from collections import OrderedDict

import yaml

ROOT = Path(__file__).resolve().parent.parent
SILVER = ROOT / "input" / "2-silver" / "books"
HUNT = SILVER / "pg5314-grimm-hunt" / "tales.yaml"


def norm(s: str) -> str:
    """Title comparison key."""
    s = unicodedata.normalize("NFKD", s)
    s = s.encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Aliases — non-trivial title equivalences across the 5 books.
# Each entry maps an alternative title (any form) → canonical Hunt title.
# Keys are normalised via norm(); values are the canonical Hunt English title.

ALIASES_TO_HUNT: dict[str, str] = {}


def _alias(*alts: str, to: str) -> None:
    for a in alts:
        ALIASES_TO_HUNT[norm(a)] = to


# Well-known cross-edition retitlings.
_alias("The Frog-Prince", "The Frog Prince", "The Frog King; or, Iron Henry",
       to="The Frog King, or Iron Henry")  # KHM 1
_alias("Oh, If I Could But Shiver!", "The Story of a Boy Who Went Forth to Learn Fear",
       to="The Story of the Youth Who Went Forth to Learn What Fear Was")  # KHM 4
_alias("The Wolf and the Seven Little Kids",
       to="The Wolf and the Seven Young Kids")  # KHM 5 (Taylor + Olcott vs Hunt)
_alias("The Little Brother and Sister", "Brother and Sister",
       "Het Broertje en het Zusje",
       to="Little Brother and Little Sister")  # KHM 11
_alias("The Three Little Men in the Wood",
       to="The Three Little Men in the Forest")  # KHM 13
_alias("Hansel and Grethel", "Haensel and Grethel", "Hansje en Grietje",
       to="Hansel and Gretel")  # KHM 15
_alias("Cinderella", "Ash-Maiden", "Ashputtel", "Asschepoester", "Aschenputtel",
       to="Cinderella")  # KHM 21 — Hunt already calls it Cinderella
_alias("Mother Holle", "Vrouw Holle", to="Frau Holle")  # KHM 24
_alias("Little Red-Cap", "Little Red Riding Hood", "Little Red Cap",
       "Little Red-Cap [Little Red Riding Hood]",
       to="Little Red-Cap")  # KHM 26 — Hunt already
_alias("The Bremen Town-Musicians", "The Travelling Musicians",
       "De Bremer Stadsmuzikanten",
       to="The Bremen Town Musicians")  # KHM 27
_alias("Catherine and Frederick", "Frederick and Catherine", "Frieder en Katerliesje",
       to="Frederick and Catherine")  # KHM 59
_alias("Snowdrop", "Snow-White", "Little Snow-White", "Sneeuwwitje", "Little Snow White",
       to="Little Snow-White")  # KHM 53
_alias("Briar Rose", "Little Briar-Rose", "Doornenroosje", "Briar-Rose",
       to="Little Briar-Rose")  # KHM 50
_alias("Rumpelstiltskin", "Rompelsteeltje", to="Rumpelstiltskin")  # KHM 55
_alias("Sweetheart Roland", "De liefste Roland", to="Sweetheart Roland")  # KHM 56
_alias("The Golden Bird", "De gouden Vogel", to="The Golden Bird")  # KHM 57
_alias("The Dog and the Sparrow", "De Hond en de Musch",
       to="The Dog and the Sparrow")  # KHM 58
_alias("The Two Brothers", "De twee Broeders", to="The Two Brothers")  # KHM 60
_alias("The Little Peasant", "Het Boerke", to="The Little Peasant")  # KHM 61
_alias("The Queen Bee", "De Bijenkoningin", to="The Queen Bee")  # KHM 62
_alias("Dummling and the Three Feathers", "The Three Feathers", "De drie Veeren",
       to="The Three Feathers")  # KHM 63
_alias("The Golden Goose", "De gouden Gans", to="The Golden Goose")  # KHM 64
_alias("Cat-Skin", "Allerleirauh", "All-Kinds-Of-Fur", "Albontje",
       to="Allerleirauh")  # KHM 65
_alias("The Hare's Bride", "Hazebruidje", to="The Hare’s Bride")  # KHM 66
_alias("The Twelve Huntsmen", "De twaalf Jagers", to="The Twelve Huntsmen")  # KHM 67
_alias("The Thief and his Master", "De Gauwdief en zijn Meester",
       to="The Thief and His Master")  # KHM 68
_alias("Jorinda and Jorindel", "Jorinda and Joringel", "Jorinde en Joringel",
       to="Jorinde and Joringel")  # KHM 69
_alias("The Three Children of Fortune", "The Three Luck-Children", "De drie Gelukskinderen",
       to="The Three Children of Fortune")  # KHM 70
_alias("How Six Men Got On in the World", "Hoe er zes door de wereld kwamen",
       to="How Six Men Got On in the World")  # KHM 71
_alias("The Wolf and the Man", "De Wolf en de Mensch", to="The Wolf and the Man")  # KHM 72
_alias("The Wolf and the Fox", "De Wolf en de Vos", to="The Wolf and the Fox")  # KHM 73
_alias("The Fox and the Cat", to="The Fox and the Cat")  # KHM 75
_alias("The Pink", to="The Pink")  # KHM 76
_alias("Clever Gretel", "Clever Grethel", to="Clever Grethel")  # KHM 77
_alias("The Old Man and his Grandson", to="The Old Man and His Grandson")  # KHM 78
_alias("The Water-Nix", to="The Water-Nix")  # KHM 79
_alias("Hans in Luck", to="Hans in Luck")  # KHM 83
_alias("The Singing, Soaring Lark", "The Singing, Springing Lark", "Lily and the Lion",
       to="The Singing, Springing Lark")  # KHM 88
_alias("The Goose-Girl", to="The Goose-Girl")  # KHM 89
_alias("The King of the Golden Mountain", to="The King of the Golden Mountain")  # KHM 92
_alias("The Raven", to="The Raven")  # KHM 93
_alias("The Water of Life", to="The Water of Life")  # KHM 97
_alias("Doctor Knowall", "Doctor Know-all", "Dr. Know-All",
       to="Dr. Know-All")  # KHM 98
_alias("The Willow-Wren and the Bear", to="The Willow-Wren and the Bear")  # KHM 102
_alias("The Poor Miller's Boy and the Cat", to="The Poor Miller’s Boy and the Cat")  # KHM 106
_alias("The Two Travellers", "The Two Travelers", to="The Two Travellers")  # KHM 107
_alias("The Jew Among Thorns", "The Miser in the Bush",
       to="The Jew among Thorns")  # KHM 110
_alias("The Four Clever Brothers", "The Four Skilful Brothers",
       to="The Four Skilful Brothers")  # KHM 129
_alias("The Blue Light", to="The Blue Light")  # KHM 116
_alias("Clever Hans", to="Clever Hans")  # KHM 32
_alias("Clever Elsie", to="Clever Elsie")  # KHM 34
_alias("Wishing-table, the Gold-ass, and the Cudgel in the Sack",
       "Little Table Set Thyself, Gold-Ass, And Cudgel Out of the Sack",
       "Tafeltje dek je, Goudezel, en Knuppel uit de zak",
       to="The Wishing-Table, the Gold-Ass, and the Cudgel in the Sack")  # KHM 36
_alias("Thumbling", "Duimpje", "Tom Thumb", to="Thumbling")  # KHM 37
_alias("The Travels of Tom Thumb", "Thumbling as Journeyman", "Hoe Duimpje op reis ging",
       to="Thumbling as Journeyman [Thumbling’s Travels]")  # KHM 45
_alias("The Wedding of Mrs Fox", "The Wedding of Mrs. Fox", "De bruiloft van vrouw Vos",
       to="The Wedding of Mrs. Fox")  # KHM 38
_alias("The Elves", "The Elves and the Shoemaker", "De Kaboutertjes",
       to="The Elves")  # KHM 39
_alias("The Robber Bridegroom", "De Rooverbruigom",
       to="The Robber Bridegroom")  # KHM 40
_alias("Herr Korbes", "Mijnheer Korbes", to="Herr Korbes")  # KHM 41
_alias("The Godfather", "De Peet", to="The Godfather")  # KHM 42
_alias("Frau Trude", "Vrouw Trude", to="Frau Trude")  # KHM 43
_alias("Godfather Death", "Peet de Dood", to="Godfather Death")  # KHM 44
_alias("Fitcher's Bird", "Fowler's Fowl", "Fitscher's Vogel",
       to="Fitcher’s Bird [Fowler’s Fowl]")  # KHM 46
_alias("The Juniper-Tree", "Van den Amandelboom",
       to="The Juniper-Tree")  # KHM 47
_alias("Old Sultan", "De oude Sultan", to="Old Sultan")  # KHM 48
_alias("The Six Swans", "De zes Zwanen", to="The Six Swans")  # KHM 49
_alias("Foundling-Bird", "Fundevogel", "Vogelbuit", "Bird-Found",
       to="Foundling-Bird")  # KHM 51
_alias("King Thrushbeard", "King Grisly-Beard", "Koning Lijsterbaard",
       to="King Thrushbeard")  # KHM 52
_alias("The Knapsack, the Hat, and the Horn", "De Ransel, het Hoedje en het Hoorntje",
       to="The Knapsack, the Hat, and the Horn")  # KHM 54
_alias("The Star-Money", to="The Star-Money")  # KHM 153
_alias("The Fisherman and his Wife", to="The Fisherman and His Wife")  # KHM 19
_alias("The White Snake", to="The White Snake")  # KHM 17
_alias("The Three Brothers", to="The Three Brothers")  # KHM 124
_alias("Iron John", "Iron Hans", to="Iron John")  # KHM 136
_alias("The Three Languages", to="The Three Languages")  # KHM 33
_alias("The Seven Ravens", to="The Seven Ravens")  # KHM 25
_alias("The Salad", "Donkey Cabbages", "The Donkey Cabbages",
       to="Donkey Cabbages")  # KHM 122
_alias("The Spindle, the Shuttle, and the Needle", to="The Spindle, the Shuttle, and the Needle")  # KHM 188
_alias("The Iron Stove", to="The Iron Stove")  # KHM 127
_alias("Sweet Porridge", to="Sweet Porridge")  # KHM 103
_alias("Snow-White and Rose-Red", to="Snow-White and Rose-Red")  # KHM 161
_alias("The Hedge-King", "The Willow-Wren", to="The Willow-Wren")  # KHM 171
_alias("One-Eye, Two-Eyes, and Three-Eyes",
       "Little One-Eye, Two-Eyes and Three-Eyes",
       to="One-Eye, Two-Eyes, and Three-Eyes")  # KHM 130
_alias("The Goose-Girl at the Well", to="The Goose-Girl at the Well")  # KHM 179
_alias("The Shoes that were Danced to Pieces", "The Twelve Dancing Princesses",
       to="The Shoes that Were Danced to Pieces")  # KHM 133
_alias("The Nix of the Mill-Pond", "The Nixie of the Mill-Pond",
       to="The Nixie of the Mill-Pond")  # KHM 181
_alias("The Little House in the Wood", "The Hut in the Forest",
       to="The Hut in the Forest")  # KHM 169
_alias("Maid Maleen", to="Maid Maleen")  # KHM 198
_alias("Rapunzel", to="Rapunzel")  # KHM 12
_alias("The Tailor in Heaven", "De kleermaker in den hemel",
       to="The Tailor in Heaven")  # KHM 35
_alias("Faithful John", to="Faithful John")  # KHM 6
_alias("Bearskin", to="Bearskin")  # KHM 101
_alias("Cat and Mouse in Partnership", to="Cat and Mouse in Partnership")  # KHM 2

# Compound Taylor entries — Taylor's "Chanticleer and Partlet" composites
# three separate KHM tales (10 + 41 + 80). Primary KHM is 10 (the first part);
# additional mappings recorded in `composite_khm` by augment routine below.
_alias("The Adventures of Chanticleer and Partlet",
       to="The Pack of Ragamuffins")  # KHM 10 — primary
COMPOSITE_KHM: dict[str, list[int]] = {
    "The Adventures of Chanticleer and Partlet": [10, 41, 80],
}


def build_hunt_index() -> dict[str, dict]:
    data = yaml.safe_load(HUNT.read_text(encoding="utf-8"))
    idx: dict[str, dict] = {}
    for t in data["tales"]:
        if t["kind"] != "tale":
            continue
        idx[norm(t["title"])] = t
        if t.get("body_title"):
            idx[norm(t["body_title"])] = t
        if t.get("title_de"):
            idx[norm(t["title_de"])] = t
    return idx


def lookup(title: str, hunt_idx: dict[str, dict]) -> dict | None:
    key = norm(title)
    if key in hunt_idx:
        return hunt_idx[key]
    aliased = ALIASES_TO_HUNT.get(key)
    if aliased and norm(aliased) in hunt_idx:
        return hunt_idx[norm(aliased)]
    return None


def augment_book(book_id: str, hunt_idx: dict[str, dict]) -> tuple[int, list[str]]:
    path = SILVER / book_id / "tales.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    matched = 0
    unmatched: list[str] = []
    for t in data["tales"]:
        if t.get("kind") == "legend":
            continue
        hit = lookup(t["title"], hunt_idx)
        if hit:
            t["khm"] = hit["khm"]
            if hit.get("atu"):
                t["atu"] = hit["atu"]
            t["kind"] = "tale"
            # Composite tales: this one Taylor text covers multiple KHM numbers.
            # Look up case-insensitively.
            tnorm = norm(t["title"])
            for ck, cv in COMPOSITE_KHM.items():
                if norm(ck) == tnorm:
                    t["composite_khm"] = cv
                    break
            matched += 1
        else:
            unmatched.append(t["title"])
            t["kind"] = "tale"
    path.write_text(yaml.dump(data, sort_keys=False, allow_unicode=True, width=1000), encoding="utf-8")
    return matched, unmatched


def main():
    hunt_idx = build_hunt_index()
    for book_id in ["pg2591-grimm-taylor", "pg11027-grimm-gruelle",
                    "pg52521-grimm-olcott", "pg22555-grimm-eeden-dutch"]:
        m, u = augment_book(book_id, hunt_idx)
        print(f"  {book_id}: matched {m}, unmatched {len(u)}")
        for t in u:
            print(f"    ? {t}")


if __name__ == "__main__":
    main()
