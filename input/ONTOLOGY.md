# Ontology

This is the canonical definition of the tale-agnostic vocabulary used
across the graph: archetypes, themes, locations, species, and symbolic
numbers. Every term here is also a node in `ontology.json` with the same
`label`, so the loader can insert them directly.

**Rule:** when extracting a new tale, prefer an existing term from this
file. If a tale genuinely introduces a recurring concept not covered
here, add a new entry below **and** mirror it into `ontology.json` in
the same change. Single-tale curiosities should not become ontology
entries — keep them as inline character/object/location nodes inside
that tale's JSON.

See [`SCHEMA.md`](./SCHEMA.md) for the surrounding graph structure
(node types, edge labels, file format).

---

## Archetypes

Narrative roles. Attached to a character with
`(character)-[:IS_ARCHETYPE]->(archetype)`. A character may carry
multiple archetypes (e.g. the wolf in Little Red-Cap is both
`predator` and `trickster`).

| label                    | name                                | when to use |
|--------------------------|-------------------------------------|-------------|
| `arc_predator`           | Predator                            | Character whose narrative function is to threaten, hunt, or devour another. Wolves, witches, ogres. |
| `arc_trickster`          | Trickster                           | Wins by cunning or disguise rather than strength. Foxes, certain wolves, clever servants. |
| `arc_cruel_stepmother`   | Cruel Stepmother                    | Stepparent who oppresses the protagonist. Cinderella, Snow White, Hansel & Gretel. |
| `arc_evil_witch`         | Evil Witch                          | Magical antagonist, usually female, often disguised. |
| `arc_humble_hero`        | Humble Hero                         | Protagonist of low status who triumphs through virtue or cleverness. |
| `arc_youngest_sibling`   | Underestimated Youngest Sibling     | Last of three (or seven) siblings, dismissed by the others, ultimately succeeds. |
| `arc_wise_helper`        | Wise Helper                         | Mentor or rescuer figure (huntsman, mother goat, kindly stranger). |
| `arc_animal_helper`      | Animal Helper                       | Speaking or magical animal who aids the protagonist. |
| `arc_disguised_villain`  | Disguised Villain                   | Antagonist whose menace depends on disguise. |
| `arc_oppressed_maiden`   | Oppressed Maiden                    | Female protagonist suffering under a tyrannical household. |
| `arc_naive_victim`       | Naive Victim                        | Character whose trust is exploited. |
| `arc_royal_rescuer`      | Royal Rescuer                       | Prince/king who marries or rescues the protagonist at the climax. |
| `arc_evil_fairy`         | Evil Fairy                          | Slighted or vengeful supernatural female who curses the protagonist (Briar Rose, similar). |
| `arc_fool`               | Fool                                | Protagonist whose absurd reasoning drives the plot; the tale is a parody of cleverness (Clever Elsie, Clever Hans). |
| `arc_greedy`             | The Greedy One                      | Character whose escalating wishes/wealth-lust drives or terminates the plot (Fisherman's wife, greedy kings). |

> Add new archetypes only when a pattern repeats across tales OR is
> central enough to the genre that future tales likely echo it
> (e.g. `arc_clever_tailor`, `arc_grateful_animal`, `arc_devil`).

## Themes

Motifs and recurring narrative patterns. Attached to a tale with
`(tale)-[:CONTAINS_THEME]->(theme)`.

| label                       | name                                | when to use |
|-----------------------------|-------------------------------------|-------------|
| `theme_envy`                | Envy                                | Antagonist driven by jealousy of the protagonist. |
| `theme_hunger`              | Hunger                              | Material scarcity drives the plot (Hansel & Gretel, The Wolf and the Seven Kids). |
| `theme_abandoned_children`  | Abandoned Children                  | Parents abandon, lose, or fail to protect their children. |
| `theme_cruel_stepfamily`    | Cruel Stepfamily                    | Mistreatment by a step-parent or step-siblings. |
| `theme_metamorphosis`       | Metamorphosis                       | Transformation between forms (man↔beast, human↔object). |
| `theme_false_death`         | False Death                         | A character appears dead but is not (Snow White, Little Red-Cap). |
| `theme_broken_promise`      | Broken Promise                      | Failure to keep a vow has narrative consequences. |
| `theme_test_of_virtue`      | Test of Virtue                      | The protagonist is tested by a stranger, often supernatural. |
| `theme_moral_punishment`    | Moral Punishment                    | Wickedness is explicitly punished, often violently. |
| `theme_disguise`            | Disguise                            | A character pretends to be someone or something else. |
| `theme_magic_pact`          | Magic Pact                          | A wish, vow, or deal with a magical entity. |
| `theme_humble_triumph`      | Humble Triumph                      | The lowly, poor, or youngest wins out. |
| `theme_forest_danger`       | Forest as Threshold of Danger       | The forest functions as a liminal, threatening space. |
| `theme_devouring`           | Devouring                           | Characters are eaten (and often disgorged or revived). |
| `theme_resurrection`        | Resurrection / Revival              | Restoring a character to life or wholeness. |
| `theme_curse`               | Curse                               | Supernatural curse with a defined release condition (Briar Rose, Frog Prince, Snow White). |
| `theme_folly`               | Folly                               | The tale satirises foolish reasoning or absurd cleverness (Clever Elsie, Clever Hans). |

## Locations

Reusable settings that recur across tales. Attached to a tale with
`(tale)-[:HAS_LOCATION]->(location)`. One-off named places (e.g. "Mr
Korbes's house") should be modelled as inline location nodes inside
that tale's JSON, not added here.

| label                  | name                  |
|------------------------|-----------------------|
| `loc_forest`           | Forest                |
| `loc_castle`           | Castle                |
| `loc_cottage`          | Cottage               |
| `loc_well`             | Well                  |
| `loc_tower`            | Tower                 |
| `loc_mill`             | Mill                  |
| `loc_river`            | River                 |
| `loc_oven`             | Oven                  |
| `loc_grandmother_house`| Grandmother's House   |
| `loc_mountains`        | Mountains             |
| `loc_cellar`           | Cellar                |

## Species

Biological / mythological species of speaking or load-bearing animals.
Attached to a character with `(character)-[:IS_SPECIES]->(species)`.

| label       | name   |
|-------------|--------|
| `sp_wolf`   | Wolf   |
| `sp_fox`    | Fox    |
| `sp_raven`  | Raven  |
| `sp_dove`   | Dove   |
| `sp_horse`  | Horse  |
| `sp_goat`   | Goat   |
| `sp_human`  | Human  |
| `sp_dwarf`  | Dwarf  |
| `sp_witch`  | Witch  |
| `sp_fish`   | Fish   |
| `sp_cat`    | Cat    |
| `sp_mouse`  | Mouse  |
| `sp_rooster`| Rooster|
| `sp_hen`    | Hen    |
| `sp_duck`   | Duck   |
| `sp_bear`   | Bear   |
| `sp_bird`   | Bird (generic, for unspecified species) |
| `sp_lion`   | Lion   |
| `sp_dragon` | Dragon |
| `sp_griffin`| Griffin|
| `sp_dog`    | Dog    |
| `sp_boar`   | Wild Boar |
| `sp_goose`  | Goose  |
| `sp_ant`    | Ant    |
| `sp_bee`    | Bee    |
| `sp_frog`   | Frog   |
| `sp_ass`    | Ass / Donkey |
| `sp_unicorn`| Unicorn|

## Symbolic Numbers

Numbers that carry recurring weight in the genre. Attached to a tale
with `(tale)-[:CONTAINS_NUMBER]->(symbol_number)` when the number is
*structurally significant* (seven dwarfs, three brothers, twelve
huntsmen) — not every passing count.

| label     | name   |
|-----------|--------|
| `num_3`   | Three  |
| `num_4`   | Four   |
| `num_7`   | Seven  |
| `num_12`  | Twelve |

---

## What does **not** belong here

- **Named characters** — even iconic ones like "Rapunzel" or "Hans". They live in their tale's JSON file with a `<slug>_<name>` label.
- **Tale-specific objects** — "Cinderella's hazel tree", "Magic Mirror", "Gingerbread House". They are `node_type: magic_object` inside the tale file with an `obj_*` label.
- **One-off locations** — "Mr Korbes's house", "the snake king's hall". Inline only.
- **Adjectives or descriptors** — "beautiful", "wicked". Use archetypes to capture the role, not adjectives.

---

## Adding a new ontology entry

1. Add a row to the appropriate section in this file with a short
   "when to use" rule.
2. Add the matching node to `ontology.json`:
   ```json
   { "label": "arc_new_thing", "node_type": "archetype", "name": "New Thing" }
   ```
3. Reference it from at least one tale JSON in the same change.

Both files must stay in sync — `ONTOLOGY.md` is the human definition,
`ontology.json` is the loader-consumable mirror.
