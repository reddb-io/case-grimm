"""Wave 2: derive more state/speech edges from existing narrative edges."""

from __future__ import annotations

import json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
TALES_DIR = ROOT / "input" / "tales"

# Per-tale manual speech act annotations beyond CURSES/PROMISES_TO.
SPEECH_ANNOTATIONS = {
    "rumpelstiltskin": [
        ("rumpelstiltskin_daughter", "speech_naming"),
        ("rumpelstiltskin", "speech_bargain"),
    ],
    "the-three-languages": [("the_three_languages_son", "speech_riddle")],
    "the-white-snake": [("the_white_snake_servant", "speech_command")],
    "king-grisly-beard": [("king_grisly_beard_father_king", "speech_command")],
    "little-red-cap": [("lrc_wolf", "speech_prohibition")],
    "the-twelve-dancing-princesses": [("the_twelve_dancing_princesses_king", "speech_command")],
    "briar-rose": [("briar_rose_evil_fairy", "speech_curse")],
    "ashputtel": [("cinderella", "speech_blessing")],
    "the-robber-bridegroom": [("the_robber_bridegroom_daughter", "speech_confession")],
    "the-fisherman-and-his-wife": [("the_fisherman_and_his_wife_ilsabill", "speech_bargain")],
    "the-frog-prince": [("the_frog_prince_frog", "speech_bargain")],
    "the-water-of-life": [("the_water_of_life_king", "speech_command")],
    "the-juniper-tree": [("the_juniper_tree_bird", "speech_naming")],
    "hansel-and-gretel": [("hg_stepmother", "speech_command")],
    "rapunzel": [("rapunzel_enchantress", "speech_curse"), ("rapunzel_enchantress", "speech_prohibition")],
    "the-goose-girl": [("the_goose_girl_old_king", "speech_riddle")],
    "the-pink": [("the_pink_king", "speech_curse")],
    "the-raven": [("the_raven_queen", "speech_curse")],
    "the-seven-ravens": [("the_seven_ravens_father", "speech_curse")],
    "snowdrop": [("evil_queen", "speech_command")],
}


def main():
    totals = defaultdict(int)

    for path in sorted(TALES_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        nodes = data["nodes"]
        edges = data["edges"]
        tid = path.stem
        node_labels = {n["label"] for n in nodes}

        # Derive state_cursed from CURSES victims.
        existing_state = {(e["from"], e["to"]) for e in edges if e.get("label") == "EXISTS_IN_STATE"}
        for e in list(edges):
            if e.get("label") == "CURSES":
                key = (e["to"], "state_cursed")
                if key not in existing_state:
                    edges.append({"from": e["to"], "to": "state_cursed", "label": "EXISTS_IN_STATE"})
                    existing_state.add(key)
                    totals["added_state_cursed"] += 1
            elif e.get("label") == "ABANDONS":
                key = (e["to"], "state_abandoned")
                if key not in existing_state:
                    edges.append({"from": e["to"], "to": "state_abandoned", "label": "EXISTS_IN_STATE"})
                    existing_state.add(key)
                    totals["added_state_abandoned"] += 1
            elif e.get("label") == "TRANSFORMS_INTO":
                key = (e["from"], "state_transformed")
                if key not in existing_state:
                    edges.append({"from": e["from"], "to": "state_transformed", "label": "EXISTS_IN_STATE"})
                    existing_state.add(key)
                    totals["added_state_transformed"] += 1

        # Manual speech act annotations.
        if tid in SPEECH_ANNOTATIONS:
            existing_speech = {(e["from"], e["to"]) for e in edges if e.get("label") == "PERFORMS_SPEECH_ACT"}
            for src, act in SPEECH_ANNOTATIONS[tid]:
                if src not in node_labels:
                    totals[f"skipped_missing_{src}"] += 1
                    continue
                key = (src, act)
                if key not in existing_speech:
                    edges.append({"from": src, "to": act, "label": "PERFORMS_SPEECH_ACT"})
                    existing_speech.add(key)
                    totals[f"added_{act}"] += 1

        data["edges"] = edges
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")

    for k, v in sorted(totals.items()):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
