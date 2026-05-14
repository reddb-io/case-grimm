"""Migration pass: applies ontology refinements across all tale JSONs.

Applies in order:
1. Drop theme_curse (redundant with law_curse_requires_counter_condition).
2. Drop agency_speech (100% coupled with PERFORMS_SPEECH_ACT).
3. Derive speech_act edges from CURSES (speech_curse) and PROMISES_TO (speech_promise).
4. Populate FUNCTIONS_AS_THRESHOLD from HAS_LOCATION via a fixed map.
5. Add atu + khm to tale nodes.
6. Subtype magic_object nodes via object_kind.
7. Add affect_* nodes + DRIVEN_BY edges (heuristic from themes).
8. Add narrative_function vocabulary + sample applications (Propp) to 5 exemplar tales.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
TALES_DIR = ROOT / "input" / "tales"
ONTOLOGY = ROOT / "input" / "ontology.json"

LOC_TO_THRESHOLD = {
    "loc_forest": "threshold_forest",
    "loc_well": "threshold_well",
    "loc_tower": "threshold_tower",
    "loc_castle": "threshold_castle",
    "loc_cottage": "threshold_cottage",
    "loc_oven": "threshold_oven",
}

# ATU = Aarne–Thompson–Uther index; KHM = Kinder- und Hausmärchen number.
# Sourced from standard Grimm references; unknowns left null.
TALE_META = {
    "the-golden-bird":                     {"atu": "550",     "khm": 57},
    "hans-in-luck":                        {"atu": "1415",    "khm": 83},
    "jorinda-and-jorindel":                {"atu": "405",     "khm": 69},
    "the-travelling-musicians":            {"atu": "130",     "khm": 27},
    "old-sultan":                          {"atu": "101",     "khm": 48},
    "the-straw-the-coal-and-the-bean":     {"atu": "295",     "khm": 18},
    "briar-rose":                          {"atu": "410",     "khm": 50},
    "the-dog-and-the-sparrow":             {"atu": "248A",    "khm": 58},
    "the-twelve-dancing-princesses":       {"atu": "306",     "khm": 133},
    "the-fisherman-and-his-wife":          {"atu": "555",     "khm": 19},
    "the-willow-wren-and-the-bear":        {"atu": "222",     "khm": 102},
    "the-frog-prince":                     {"atu": "440",     "khm": 1},
    "cat-and-mouse-in-partnership":        {"atu": "15",      "khm": 2},
    "the-goose-girl":                      {"atu": "533",     "khm": 89},
    "chanticleer-and-partlet":             {"atu": "20C",     "khm": "10/41/80"},
    "rapunzel":                            {"atu": "310",     "khm": 12},
    "fundevogel":                          {"atu": "313",     "khm": 51},
    "the-valiant-little-tailor":           {"atu": "1640",    "khm": 20},
    "hansel-and-gretel":                   {"atu": "327A",    "khm": 15},
    "the-mouse-the-bird-and-the-sausage":  {"atu": "85",      "khm": 23},
    "mother-holle":                        {"atu": "480",     "khm": 24},
    "little-red-cap":                      {"atu": "333",     "khm": 26},
    "the-robber-bridegroom":               {"atu": "955",     "khm": 40},
    "tom-thumb":                           {"atu": "700",     "khm": 37},
    "rumpelstiltskin":                     {"atu": "500",     "khm": 55},
    "clever-gretel":                       {"atu": "1741",    "khm": 77},
    "the-old-man-and-his-grandson":        {"atu": "980B",    "khm": 78},
    "the-little-peasant":                  {"atu": "1535",    "khm": 61},
    "frederick-and-catherine":             {"atu": "1387",    "khm": 59},
    "sweetheart-roland":                   {"atu": "1119",    "khm": 56},
    "snowdrop":                            {"atu": "709",     "khm": 53},
    "the-pink":                            {"atu": "652",     "khm": 76},
    "clever-elsie":                        {"atu": "1450",    "khm": 34},
    "the-miser-in-the-bush":               {"atu": "592",     "khm": 110},
    "ashputtel":                           {"atu": "510A",    "khm": 21},
    "the-white-snake":                     {"atu": "673",     "khm": 17},
    "the-wolf-and-the-seven-little-kids":  {"atu": "123",     "khm": 5},
    "the-queen-bee":                       {"atu": "554",     "khm": 62},
    "the-elves-and-the-shoemaker":         {"atu": "503",     "khm": 39},
    "the-juniper-tree":                    {"atu": "720",     "khm": 47},
    "the-turnip":                          {"atu": "1689A",   "khm": 146},
    "clever-hans":                         {"atu": "1696",    "khm": 32},
    "the-three-languages":                 {"atu": "671",     "khm": 33},
    "the-fox-and-the-cat":                 {"atu": "105",     "khm": 75},
    "the-four-clever-brothers":            {"atu": "653",     "khm": 129},
    "lily-and-the-lion":                   {"atu": "425C",    "khm": 88},
    "the-fox-and-the-horse":               {"atu": "47A",     "khm": 132},
    "the-blue-light":                      {"atu": "562",     "khm": 116},
    "the-raven":                           {"atu": "401",     "khm": 93},
    "the-golden-goose":                    {"atu": "571",     "khm": 64},
    "the-water-of-life":                   {"atu": "551",     "khm": 97},
    "the-twelve-huntsmen":                 {"atu": "884",     "khm": 67},
    "the-king-of-the-golden-mountain":     {"atu": "400",     "khm": 92},
    "doctor-knowall":                      {"atu": "1641",    "khm": 98},
    "the-seven-ravens":                    {"atu": "451",     "khm": 25},
    "the-wedding-of-mrs-fox":              {"atu": "65",      "khm": 38},
    "the-salad":                           {"atu": "566",     "khm": 122},
    "the-youth-who-went-forth-to-learn-what-fear-was": {"atu": "326", "khm": 4},
    "king-grisly-beard":                   {"atu": "900",     "khm": 52},
    "iron-hans":                           {"atu": "502",     "khm": 136},
    "cat-skin":                            {"atu": "510B",    "khm": 65},
    "snow-white-and-rose-red":             {"atu": "426",     "khm": 161},
}

# object_kind heuristic — pattern → kind.
# Order matters: first match wins. Tested against all 116 names.
OBJECT_KIND_RULES = [
    # creature_object: object that IS a living creature (key trait)
    (r"\b(golden bird|golden horse|golden goose|white snake|black poodle|falada|severed head|gold-producing bird's heart)\b", "creature_object"),
    (r"\bgolden hen and twelve chicks\b", "creature_object"),

    # food: consumable substances
    (r"\b(apple|rampion|salad|loaf|bread|wine|water of life|fish|cheese|nut|peas and lentils|good salad|bad salad|cold water|meat)\b", "food"),

    # garment: wearable
    (r"\b(dress|gown|cloak|mantle|cap|boots|apron|armor|girdle|shoes|fur)\b", "garment"),

    # weapon: explicit weapon
    (r"\b(sword|bow)\b", "weapon"),

    # instrument: musical / sound-producing
    (r"\b(fiddle|pipe|bell-net|tobacco pipe)\b", "instrument"),

    # tool: actively-wielded non-weapon
    (r"\b(wand|spindle|wheel|pickaxe|stick|ladder|needle|key|piece of wood|iron wand|door-wand|iron door|magic glass|all-seeing glass)\b", "tool"),

    # book
    (r"\babc book\b", "book"),

    # token: small portable, recognition/exchange
    (r"\b(ring|necklace|brooch|ball|slipper|chain|lock of hair|severed finger|drops of blood|red shoes|gold cup|cup)\b", "token"),

    # trail: trace / path marker
    (r"\b(breadcrumb trail|trail|pebbles|peas and lentils)\b", "trail"),

    # treasure: bulk wealth / branches
    (r"\b(treasure|shower of gold|gold-leaf|silver-leaf|diamond-leaf|branch|gold ring with|family gold ring|raven's gold ring)\b", "treasure"),

    # architecture: place-objects, immovable or built
    (r"\b(house|tree|well|mountain|hedge|tower|door|oven|road|pigsty|coffin|chest|cage|millstone|cages)\b", "architecture"),

    # material: substance transformed
    (r"\b(straw|pitch|flies|turnip|blue light|painted calf|wooden calf|wooden bowl)\b", "material"),
]

def classify_object(name: str) -> str:
    low = name.lower()
    for pattern, kind in OBJECT_KIND_RULES:
        if re.search(pattern, low):
            return kind
    return "relic"  # fallback: charged miscellany

# affect heuristic: theme presence → affects driving the tale.
THEME_TO_AFFECT = {
    "theme_envy": ["affect_envy"],
    "theme_hunger": ["affect_hunger"],
    "theme_abandoned_children": ["affect_fear"],
    "theme_cruel_stepfamily": ["affect_envy"],
    "theme_forest_danger": ["affect_fear"],
    "theme_devouring": ["affect_fear"],
    "theme_folly": [],
    "theme_humble_triumph": ["affect_longing"],
    "theme_magic_pact": ["affect_greed"],
    "theme_broken_promise": ["affect_greed"],
}

# Five exemplar tales for Propp narrative_function annotation.
PROPP_EXEMPLARS = {
    "hansel-and-gretel": [
        ("hansel_gretel_tale", "func_villainy", 1),       # stepmother plots abandonment
        ("hansel_gretel_tale", "func_departure", 2),      # children sent to forest
        ("hansel_gretel_tale", "func_struggle", 3),       # witch captures Hansel
        ("hansel_gretel_tale", "func_victory", 4),        # Gretel pushes witch into oven
        ("hansel_gretel_tale", "func_return", 5),         # children return home with treasure
    ],
    "rumpelstiltskin": [
        ("rumpelstiltskin_tale", "func_lack", 1),
        ("rumpelstiltskin_tale", "func_donor_test", 2),
        ("rumpelstiltskin_tale", "func_magical_agent", 3),
        ("rumpelstiltskin_tale", "func_difficult_task", 4),
        ("rumpelstiltskin_tale", "func_solution", 5),
    ],
    "snowdrop": [
        ("snowdrop_tale", "func_villainy", 1),
        ("snowdrop_tale", "func_departure", 2),
        ("snowdrop_tale", "func_struggle", 3),
        ("snowdrop_tale", "func_branding", 4),  # poisoned apple / coffin
        ("snowdrop_tale", "func_recognition", 5),
        ("snowdrop_tale", "func_wedding", 6),
    ],
    "little-red-cap": [
        ("little_red_cap_tale", "func_interdiction", 1),
        ("little_red_cap_tale", "func_violation", 2),
        ("little_red_cap_tale", "func_villainy", 3),
        ("little_red_cap_tale", "func_rescue", 4),
    ],
    "ashputtel": [
        ("ashputtel_tale", "func_villainy", 1),
        ("ashputtel_tale", "func_magical_agent", 2),
        ("ashputtel_tale", "func_difficult_task", 3),
        ("ashputtel_tale", "func_recognition", 4),
        ("ashputtel_tale", "func_wedding", 5),
        ("ashputtel_tale", "func_punishment", 6),
    ],
}


def tale_id_from_path(path: Path) -> str:
    return path.stem


def find_tale_node_label(nodes):
    for n in nodes:
        if n.get("node_type") == "tale":
            return n["label"]
    return None


def migrate_tale_file(path: Path) -> dict:
    """Returns stats per file."""
    data = json.loads(path.read_text())
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    stats = defaultdict(int)
    tid = tale_id_from_path(path)
    tale_label = find_tale_node_label(nodes)

    # (1) drop CONTAINS_THEME→theme_curse
    new_edges = []
    for e in edges:
        if e.get("label") == "CONTAINS_THEME" and e.get("to") == "theme_curse":
            stats["dropped_theme_curse"] += 1
            continue
        # (2) drop GAINS_AGENCY_THROUGH→agency_speech
        if e.get("label") == "GAINS_AGENCY_THROUGH" and e.get("to") == "agency_speech":
            stats["dropped_agency_speech"] += 1
            continue
        new_edges.append(e)
    edges = new_edges

    # (3) derive speech acts from CURSES/PROMISES_TO
    existing_speech = {(e["from"], e["to"]) for e in edges if e.get("label") == "PERFORMS_SPEECH_ACT"}
    for e in list(edges):
        if e.get("label") == "CURSES":
            key = (e["from"], "speech_curse")
            if key not in existing_speech:
                edges.append({"from": e["from"], "to": "speech_curse", "label": "PERFORMS_SPEECH_ACT"})
                existing_speech.add(key)
                stats["added_speech_curse"] += 1
        elif e.get("label") == "PROMISES_TO":
            key = (e["from"], "speech_promise")
            if key not in existing_speech:
                edges.append({"from": e["from"], "to": "speech_promise", "label": "PERFORMS_SPEECH_ACT"})
                existing_speech.add(key)
                stats["added_speech_promise"] += 1

    # (4) populate FUNCTIONS_AS_THRESHOLD from HAS_LOCATION
    existing_thresh = {(e["from"], e["to"]) for e in edges if e.get("label") == "FUNCTIONS_AS_THRESHOLD"}
    for e in list(edges):
        if e.get("label") == "HAS_LOCATION" and e.get("to") in LOC_TO_THRESHOLD:
            loc = e["to"]
            thresh = LOC_TO_THRESHOLD[loc]
            key = (loc, thresh)
            if key not in existing_thresh:
                edges.append({"from": loc, "to": thresh, "label": "FUNCTIONS_AS_THRESHOLD"})
                existing_thresh.add(key)
                stats["added_threshold"] += 1

    # (5) add atu + khm to tale node
    meta = TALE_META.get(tid)
    if meta and tale_label:
        for n in nodes:
            if n["label"] == tale_label:
                if "atu" not in n:
                    n["atu"] = meta["atu"]
                    stats["added_atu"] += 1
                if "khm" not in n:
                    n["khm"] = meta["khm"]
                    stats["added_khm"] += 1

    # (6) sub-type magic_object with object_kind
    for n in nodes:
        if n.get("node_type") == "magic_object" and "object_kind" not in n:
            n["object_kind"] = classify_object(n["name"])
            stats[f"object_kind_{n['object_kind']}"] += 1

    # (7) affect layer: DRIVEN_BY edges from tale → affect
    themes_in_tale = {e["to"] for e in edges if e.get("label") == "CONTAINS_THEME"}
    if tale_label:
        existing_drive = {(e["from"], e["to"]) for e in edges if e.get("label") == "DRIVEN_BY"}
        for theme in themes_in_tale:
            for aff in THEME_TO_AFFECT.get(theme, []):
                key = (tale_label, aff)
                if key not in existing_drive:
                    edges.append({"from": tale_label, "to": aff, "label": "DRIVEN_BY"})
                    existing_drive.add(key)
                    stats["added_driven_by"] += 1

    # (8) Propp annotations for exemplars
    if tid in PROPP_EXEMPLARS:
        existing_funcs = {(e["from"], e["to"]) for e in edges if e.get("label") == "HAS_FUNCTION"}
        for src, fn, order in PROPP_EXEMPLARS[tid]:
            key = (src, fn)
            if key not in existing_funcs:
                edges.append({"from": src, "to": fn, "label": "HAS_FUNCTION", "order": order})
                existing_funcs.add(key)
                stats["added_propp"] += 1

    data["nodes"] = nodes
    data["edges"] = edges
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return dict(stats)


def migrate_ontology() -> dict:
    data = json.loads(ONTOLOGY.read_text())
    nodes = data["nodes"]
    stats = defaultdict(int)

    # Drop theme_curse and agency_speech nodes.
    drop_labels = {"theme_curse", "agency_speech"}
    new_nodes = []
    for n in nodes:
        if n["label"] in drop_labels:
            stats[f"dropped_{n['label']}"] += 1
            continue
        new_nodes.append(n)

    # Add affect nodes.
    affects = [
        ("affect_fear",    "Fear",    "Anticipation of harm drives a character's choices: hiding, fleeing, freezing, lying."),
        ("affect_envy",    "Envy",    "Resentment of another's beauty, status, or fortune drives plot, often into harm."),
        ("affect_longing", "Longing", "Desire for an absent person, status, child, or sign drives quest or pact."),
        ("affect_greed",   "Greed",   "Appetite for more (wealth, wishes, status, food) drives escalation and ruin."),
        ("affect_pity",    "Pity",    "Compassion suspends violence and unlocks aid."),
        ("affect_hunger",  "Hunger",  "Bodily need overrides reasoning, kinship, or caution."),
        ("affect_love",    "Love",    "Bond pulls a character into rescue, fidelity, sacrifice, or recognition."),
    ]
    existing = {n["label"] for n in new_nodes}
    for label, name, desc in affects:
        if label in existing:
            continue
        new_nodes.append({
            "label": label,
            "node_type": "affect",
            "name": name,
            "description": desc,
        })
        stats[f"added_{label}"] += 1

    # Add narrative_function nodes (Propp, simplified to 13).
    funcs = [
        ("func_absentation",    "Absentation",            1,  "A family member is absent or removed from home."),
        ("func_interdiction",   "Interdiction",           2,  "A prohibition is addressed to the hero."),
        ("func_violation",      "Violation",              3,  "The prohibition is broken."),
        ("func_villainy",       "Villainy / Lack",        4,  "Antagonist causes harm or a family lacks something vital."),
        ("func_lack",           "Lack",                   4,  "Something is missing whose absence drives the tale."),
        ("func_departure",      "Departure",              5,  "The hero leaves home."),
        ("func_donor_test",     "Donor Test",             6,  "Hero is tested by a donor figure (witch, dwarf, animal, stranger)."),
        ("func_magical_agent",  "Magical Agent",          7,  "Hero acquires a magical helper or object."),
        ("func_struggle",       "Struggle",               8,  "Hero and villain join direct battle or contest."),
        ("func_branding",       "Branding",               9,  "Hero is marked, wounded, or transformed."),
        ("func_victory",        "Victory",                10, "Villain is defeated."),
        ("func_rescue",         "Rescue",                 11, "Hero (or victim) is saved from danger."),
        ("func_difficult_task", "Difficult Task",         12, "A hard task is set."),
        ("func_solution",       "Solution",               13, "The task is solved."),
        ("func_recognition",    "Recognition",            14, "Hero's true identity or worth is recognized."),
        ("func_exposure",       "Exposure",               15, "A false hero or villain is exposed."),
        ("func_punishment",     "Punishment",             16, "Villain or false hero is punished."),
        ("func_wedding",        "Wedding / Elevation",    17, "Hero marries or ascends."),
        ("func_return",         "Return",                 18, "Hero returns home transformed."),
    ]
    for label, name, _order, desc in funcs:
        if label in existing:
            continue
        new_nodes.append({
            "label": label,
            "node_type": "narrative_function",
            "name": name,
            "description": desc,
        })
        stats[f"added_{label}"] += 1

    data["nodes"] = new_nodes
    ONTOLOGY.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return dict(stats)


def main():
    onto_stats = migrate_ontology()
    print("=== ontology.json ===")
    for k, v in sorted(onto_stats.items()):
        print(f"  {k}: {v}")

    totals = defaultdict(int)
    for path in sorted(TALES_DIR.glob("*.json")):
        s = migrate_tale_file(path)
        for k, v in s.items():
            totals[k] += v
    print()
    print("=== tale files ===")
    for k, v in sorted(totals.items()):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
