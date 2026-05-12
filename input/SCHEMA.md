# Graph Schema

All data lives in a single RedDB collection: **`tales`**.

This document describes the node types, edge labels, file layout, and
naming conventions used in `input/**/*.json`.

For the **tale-agnostic vocabulary** (archetypes, themes, locations,
species, symbolic numbers), see [`ONTOLOGY.md`](./ONTOLOGY.md).

---

## File layout

```
input/
├── books.txt           # raw Gutenberg corpus
├── tales.json          # manifest of every tale in books.txt (not graph data)
├── SCHEMA.md           # this file
├── ontology.json       # tale-agnostic shared nodes (archetypes, themes, species, numbers)
└── tales/
    └── <slug>.json     # one file per modelled tale (e.g. cinderella.json)
```

The loader walks `input/` recursively. It treats any `*.json` file
containing a `collection` field as graph data — concatenates the
`nodes` and `edges` arrays and **dedupes nodes by `label`** so the same
archetype or theme can be referenced from multiple tale files without
inserting twice. Files without a `collection` field (like `tales.json`)
are ignored by the loader.

### File format

```json
{
  "$schema": "./grimm-graph.schema.json",
  "collection": "tales",
  "nodes": [
    { "label": "snow_white", "node_type": "character", "name": "Snow White" }
  ],
  "edges": [
    { "from": "snow_white", "to": "snow_white_tale", "label": "APPEARS_IN" }
  ]
}
```

- `collection` must be the same in every file (`tales`).
- `nodes[].label` is a unique slug across the whole graph. Use the
  conventions in the next section.
- `edges[].from` and `edges[].to` reference node labels.

---

## Node types

| node_type       | meaning                                              | label convention                         |
|-----------------|------------------------------------------------------|------------------------------------------|
| `tale`          | A story in the collection                            | `<story_slug>_tale`                      |
| `character`     | Named character (human, animal, supernatural)        | `<story_slug>_<name>` or unique slug     |
| `location`      | Place that appears in a tale                         | `loc_<name>`                             |
| `magic_object`  | Object with magical properties or narrative weight   | `obj_<name>`                             |
| `archetype`     | Narrative role / character type (tale-agnostic)      | `arc_<name>`                             |
| `theme`         | Recurring motif or moral theme                       | `theme_<name>`                           |
| `species`       | Biological / mythological species                    | `sp_<name>`                              |
| `symbol_number` | Numerologically loaded number                        | `num_<n>`                                |

### Examples

```json
{ "label": "cinderella_tale",  "node_type": "tale",         "name": "Cinderella" }
{ "label": "cinderella",       "node_type": "character",    "name": "Cinderella" }
{ "label": "loc_forest",       "node_type": "location",     "name": "The Forest" }
{ "label": "obj_magic_mirror", "node_type": "magic_object", "name": "Magic Mirror" }
{ "label": "arc_trickster",    "node_type": "archetype",    "name": "Trickster" }
{ "label": "theme_hunger",     "node_type": "theme",        "name": "Hunger" }
{ "label": "sp_wolf",          "node_type": "species",      "name": "Wolf" }
{ "label": "num_7",            "node_type": "symbol_number","name": "Seven" }
```

> The `<story_slug>_<name>` convention for characters disambiguates
> figures that recur across tales (every "prince" is different). When
> two tales genuinely share a character, link both via `IS_SAME_AS`.

---

## Edge labels

Edges are **directed**. Direction is part of the meaning — `A EATS B`
means A devours B, not the reverse.

### Narrative edges (character ↔ character / character ↔ object)

| label              | direction (from → to)                       | example                                  |
|--------------------|---------------------------------------------|------------------------------------------|
| `MARRIES`          | spouse → spouse                             | `cinderella` → `cinderella_prince`        |
| `CHILD_OF`         | child → parent                              | `hansel` → `hg_father`                   |
| `SIBLING_OF`       | symmetric — emit **both directions**        | `hansel` ↔ `gretel`                       |
| `OPPRESSED_BY`     | victim → oppressor                          | `cinderella` → `stepmother`              |
| `MISTREATED_BY`    | victim → oppressor                          | `cinderella` → `stepsister_1`            |
| `ENVIES`           | envier → envied                             | `evil_queen` → `snow_white`              |
| `COMMANDS`         | superior → subordinate                      | `evil_queen` → `huntsman`                |
| `SPARES`           | aggressor → spared                          | `huntsman` → `snow_white`                |
| `SHELTERS`         | host → guest                                | `dwarf_doc` → `snow_white`               |
| `HELPS`            | helper → helped                             | `white_dove` → `cinderella`              |
| `RESCUES`          | rescuer → rescued                           | `gretel` → `hansel`                      |
| `KILLS`            | killer → victim                             | `gretel` → `witch`                       |
| `EATS`             | eater → eaten                               | `wolf` → `little_red_cap`                |
| `CAPTURES`         | captor → captive                            | `witch` → `hansel`                       |
| `ABANDONS`         | abandoner → abandoned                       | `hg_stepmother` → `hansel`               |
| `DECEIVES`         | deceiver → deceived                         | `wolf` → `little_red_cap`                |
| `TRANSFORMS_INTO`  | original → transformed form                 | `prince` → `frog`                        |
| `CURSES`           | curser → cursed                             | `witch` → `briar_rose`                   |
| `PROMISES_TO`      | promiser → promisee                         | `miller_daughter` → `rumpelstiltskin`    |
| `OWNS`             | owner → object                              | `evil_queen` → `obj_magic_mirror`        |
| `ANSWERS_TO`       | object → person it obeys                    | `obj_magic_mirror` → `evil_queen`        |
| `PLANTED`          | planter → plant                             | `cinderella` → `obj_hazel_tree`          |
| `NESTS_IN`         | animal → location/object                    | `white_dove` → `obj_hazel_tree`          |

### Classification edges (entity → ontology)

| label              | direction (from → to)                       | example                                  |
|--------------------|---------------------------------------------|------------------------------------------|
| `IS_ARCHETYPE`     | character → archetype                       | `wolf_lrc` → `arc_predator`              |
| `IS_SPECIES`       | character → species                         | `wolf_lrc` → `sp_wolf`                   |
| `IS_SAME_AS`       | character → character (cross-tale identity) | `wolf_lrc` → `wolf_seven_kids` (if same) |

### Tale-level edges (anything → tale)

| label                | direction (from → to)                       | example                                  |
|----------------------|---------------------------------------------|------------------------------------------|
| `APPEARS_IN`         | character → tale                            | `snow_white` → `snow_white_tale`         |
| `CONTAINS_THEME`     | tale → theme                                | `snow_white_tale` → `theme_envy`         |
| `HAS_LOCATION`       | tale → location                             | `hansel_gretel_tale` → `loc_forest`      |
| `HAS_MAGIC_OBJECT`   | tale → magic_object                         | `snow_white_tale` → `obj_magic_mirror`   |
| `CONTAINS_NUMBER`    | tale → symbol_number                        | `snow_white_tale` → `num_7`              |

---

## Conventions

1. **Per-tale character labels.** A "prince" in Cinderella and a "prince" in Snow White are different characters; use distinct labels (`cinderella_prince`, `snow_prince`).
2. **Shared ontology in `ontology.json`.** Archetypes, themes, species, symbolic numbers live in one file and are referenced from every tale.
3. **Symmetric edges are emitted in both directions.** `SIBLING_OF`, `IS_SAME_AS`, `MARRIES` (if you want symmetric semantics) — write both rows.
4. **Edges are typed by label, not by node type.** `(character)-[:EATS]->(character)` and `(witch)-[:EATS]->(child)` share the same label; the type system is in the nodes, not the edges.
5. **Don't over-link.** If a character is mentioned in passing without driving the plot, skip the `APPEARS_IN` edge. The graph models *narrative weight*, not raw token presence.

---

## Sample queries

```sql
-- All characters sharing the "predator" archetype
MATCH (c)-[r:IS_ARCHETYPE]->(a)
WHERE a.label = 'arc_predator'
RETURN c.name;

-- Tales that involve the number 7
MATCH (t)-[r:CONTAINS_NUMBER]->(n)
WHERE n.label = 'num_7'
RETURN t.name;

-- Multi-hop: tales sharing a theme with Snow White
MATCH (snow_white_tale)-[:CONTAINS_THEME]->(theme)<-[:CONTAINS_THEME]-(other)
WHERE other.label <> 'snow_white_tale'
RETURN other.name, theme.name;

-- Who deceives whom across the whole collection?
MATCH (a)-[r:DECEIVES]->(b)
RETURN a.name, b.name;
```
