# Grimms' Fairy Tales — RedDB Graph Playground

An executable folklore graph built with [RedDB](https://github.com/reddb-io/reddb).

This repo turns the **Grimms' Fairy Tales** corpus into a graph of characters,
tales, archetypes, themes, places, magic objects, symbolic numbers, and the
relationships between them. It also ships a committed RedDB snapshot, so users
can query the graph immediately instead of waiting for ingestion.

The fun part: the graph starts surfacing folklore structure. Cinderella maps
onto the miller's daughter from *Rumpelstiltskin*. The Little Red-Cap wolf maps
onto a human cannibal bridegroom. The Frog Prince splits into two roles in
*Lily and the Lion*. Those are not hard-coded comparisons; they fall out of the
ontology and graph.

## Try It

```bash
cd src/embedded
pnpm install
pnpm start
pnpm query "GRAPH CENTRALITY"
pnpm sim cinderella 3
```

The committed snapshot contains:

| item | count |
|------|------:|
| tales | 62 |
| graph nodes | 655 |
| graph edges | 1,741 |
| characters | 402 |
| magic objects | 116 |
| archetypes | 15 |
| themes | 17 |

## Goal

Learn and showcase RedDB's **graph** model by mapping:

- **Nodes** — characters, stories, archetypes, themes, locations, magic objects, symbolic numbers.
- **Edges** — `APPEARS_IN`, `MARRIES`, `KILLS`, `HELPS`, `DECEIVES`, `EATS`,
  `IS_ARCHETYPE`, `CONTAINS_THEME`, `HAS_LOCATION`, `HAS_MAGIC_OBJECT`, etc.

Then explore questions like:

- Which characters appear in more than one tale?
- Which animals speak? Which characters get devoured?
- Which tales share a theme (forest, hunger, false death, broken promise)?
- How often does the number 7 show up across stories?
- Multi-hop traversals (prince → bride → stepmother → witch).
- Ad hoc SQL and graph-algorithm queries against the committed database.

## Things The Graph Finds

| Try | Result |
|-----|--------|
| `pnpm sim cinderella 3` | Cinderella's strongest cross-tale match is the miller's daughter from *Rumpelstiltskin* at **63.6%**. They share `humble_hero`, `oppressed_maiden`, `castle`, `num_3`, `humble_triumph`, `magic_pact`, and `test_of_virtue`. |
| `pnpm sim lrc_wolf 4` | The Little Red-Cap wolf matches the Seven Kids wolf at **69.2%**, but also the **human** cannibal bridegroom from *The Robber Bridegroom* at **46.7%**. Same predator function, different species. |
| `pnpm sim gingerbread_witch 3` | The Hansel & Gretel witch's best cross-tale match is Old Sanna from *Fundevogel* at **43.8%**: another forest witch / predator / child-cooking pattern. |
| `pnpm sim the_frog_prince_frog 3` | The Frog Prince maps equally to the Griffin and the enchanted Lion-Prince in *Lily and the Lion* at **57.1%** each. One compact character in one tale becomes two roles in another. |
| `pnpm query "GRAPH CENTRALITY"` | The most central concepts are not specific princes or princesses; they are `arc_humble_hero`, `arc_wise_helper`, `theme_humble_triumph`, `loc_forest`, and `arc_trickster`. |
| `pnpm query "SELECT COUNT(*) FROM tales WHERE label = 'DECEIVES'"` | Deception appears **71** times across the graph. |

## Stack

- **RedDB** — multi-model engine (graph + document + vector).
- **pnpm** — package manager.
- **TypeScript / Node** — ingestion and query scripts.

## Layout

```
.
├── input/                  # corpus + curated structured data — see input/SCHEMA.md
│   ├── BOOKS.txt           # raw Gutenberg corpus
│   ├── TALES.json          # manifest of every tale in BOOKS.txt + modelled status
│   ├── SCHEMA.md           # graph schema: node types, edge labels, conventions
│   ├── ONTOLOGY.md         # canonical definition of the tale-agnostic vocabulary
│   ├── ontology.json       # loader-consumable mirror of ONTOLOGY.md
│   └── tales/
│       ├── <slug>.txt      # tale body sliced from BOOKS.txt
│       └── <slug>.json     # graph data for that tale (modelled only)
├── src/
│   ├── shared/             # shared loader (recursive glob + dedupe)
│   ├── embedded/           # RedDB embedded in-process (@reddb-io/sdk)
│   └── server/             # RedDB as a Docker server + HTTP client
├── output/                 # committed snapshots + runtime output
└── README.md
```

Folder conventions:

- **`input/`** — the source of truth: raw corpus + every curated graph JSON.
  The loader walks this tree recursively and treats any `.json` file
  containing a `collection` field as graph data. Files without one
  (like `TALES.json`) are ignored by the loader.
- **`input/TALES.json`** — manifest listing every tale found in `BOOKS.txt`,
  with `modelled: true|false` and a pointer to the graph file when modelled.
- **`output/`** — committed RedDB snapshots plus generated runtime files.
  `embedded.rdb` is ready to query locally; `server.rdb` is the server-mode
  snapshot used by `docker-compose.yml`. Logs and result caches stay ignored.

## Examples

| Example | When to use it                                | Stack                              | DB file               |
|---------|-----------------------------------------------|------------------------------------|-----------------------|
| [embedded](./src/embedded) | local scripts, ETL, single-process | `@reddb-io/sdk` + stdio JSON-RPC   | `output/embedded.rdb` |
| [server](./src/server)     | multiple clients, containers      | Docker + HTTP JSON (native fetch)  | `output/server.rdb`   |

The `embedded` example also ships **`pnpm sim <character>`** — a Jaccard
similarity engine over each character's ontological fingerprint (archetypes
+ species + their tale's themes/locations/numbers). Surfaces cross-tale
narrative parallels like *"Cinderella is structurally the miller's
daughter in Rumpelstiltskin (64%)"* or *"the cannibal bridegroom plays
the Little Red-Cap wolf's role (47%)"*. See [`src/embedded/README.md`](./src/embedded/README.md#pnpm-sim-character_slug-topn---same-tale--similarity-engine) for cooler examples.

Both walk `input/` recursively (via `src/shared/load-graph.ts`) and
populate the same `tales` collection. Nodes are deduped by `label`, so
shared ontology entries (archetypes, themes, etc.) are inserted once even
if referenced from multiple tale files.

See [`input/SCHEMA.md`](./input/SCHEMA.md) for the full list of node types,
edge labels, naming conventions, and sample queries.

## What You Can Test

The repo includes a committed `output/embedded.rdb`, so users can query the
graph immediately after installing dependencies. No ingest step is required
unless they delete the database or point `REDDB_URI` somewhere else.

```bash
cd src/embedded
pnpm install
```

Run the full demo suite against the committed database:

```bash
pnpm start
```

This opens `../../output/embedded.rdb`, skips ingest when the collection is
already populated, then prints:

- entity counts by type (`character`, `tale`, `theme`, `archetype`, etc.)
- most common edge labels (`APPEARS_IN`, `IS_ARCHETYPE`, `DECEIVES`, ...)
- counts for narrative actions like `EATS`, `KILLS`, `CURSES`, `RESCUES`
- graph analytics: `CENTRALITY`, `COMMUNITY`, `COMPONENTS`, `CYCLES`,
  `CLUSTERING`, `PROPERTIES`
- shortest paths between known characters such as `evil_queen → snow_white`
  and `lrc_wolf → wsk_wolf`

Ask ad hoc SQL/GRAPH questions with `pnpm query`. Example commands and
results from the committed snapshot:

```bash
pnpm query "SELECT node_type, COUNT(*) FROM tales WHERE node_type IS NOT NULL GROUP BY node_type"
```

| node_type | count |
|-----------|------:|
| character | 402 |
| magic_object | 116 |
| tale | 62 |
| species | 28 |
| theme | 17 |
| archetype | 15 |
| location | 11 |
| symbol_number | 4 |

```bash
pnpm query "SELECT label, COUNT(*) FROM tales WHERE node_type IS NULL GROUP BY label"
```

Top relationship counts:

| label | count |
|-------|------:|
| `APPEARS_IN` | 399 |
| `IS_ARCHETYPE` | 286 |
| `CONTAINS_THEME` | 253 |
| `HAS_MAGIC_OBJECT` | 116 |
| `HAS_LOCATION` | 109 |
| `IS_SPECIES` | 99 |
| `CHILD_OF` | 75 |
| `DECEIVES` | 71 |
| `HELPS` | 59 |
| `SIBLING_OF` | 44 |

```bash
pnpm query "SELECT COUNT(*) FROM tales WHERE label = 'DECEIVES'"
```

| count |
|------:|
| 71 |

```bash
pnpm query "GRAPH CENTRALITY"
```

Top central nodes:

| label | score |
|-------|------:|
| `arc_humble_hero` | 49 |
| `arc_wise_helper` | 39 |
| `theme_humble_triumph` | 37 |
| `loc_forest` | 34 |
| `arc_trickster` | 33 |
| `theme_moral_punishment` | 33 |
| `loc_castle` | 30 |
| `theme_test_of_virtue` | 29 |
| `arc_animal_helper` | 28 |
| `arc_fool` | 27 |

```bash
pnpm query "GRAPH PROPERTIES"
```

| node_count | edge_count | density | is_connected | is_cyclic |
|-----------:|-----------:|--------:|--------------|-----------|
| 655 | 1741 | 0.007619581203165488 | false | true |

```bash
pnpm query "GRAPH NEIGHBORHOOD '128' DIRECTION both"
```

Excerpt for node `128` (`theme_humble_triumph`):

| depth | label | node_id |
|------:|-------|--------:|
| 0 | `theme_humble_triumph` | 128 |
| 1 | `cinderella_tale` | 177 |
| 1 | `hansel_gretel_tale` | 275 |
| 1 | `rumpelstiltskin_tale` | 358 |
| 1 | `the_golden_goose_tale` | 471 |
| 1 | `the_valiant_little_tailor_tale` | 676 |

Try narrative-similarity questions with the ontology fingerprint engine:

```bash
pnpm sim cinderella 5
pnpm sim lrc_wolf 5
pnpm sim gingerbread_witch 4
pnpm sim the_frog_prince_frog 3
```

Good questions this project can answer today:

- Which archetypes and themes are most central across the modelled tales?
- Which edge types dominate the corpus?
- How often do actions like deception, killing, rescue, capture, or devouring
  appear?
- Which tales or characters are connected by short graph paths?
- Which characters in different tales play similar narrative roles?

### Coverage

`input/TALES.json` is the authoritative manifest. Today: **62 / 62 tales modelled**.

| status     | tales |
|------------|-------|
| modelled   | all 62 tales from `BOOKS.txt` |
| pending    | none |

To add a new tale: drop `input/tales/<slug>.json` following the format
in `SCHEMA.md`, then flip the matching entry in `TALES.json` to
`"modelled": true` and point `data_file` at it. No code changes needed.

## Roadmap

1. [ ] Add more curated relationships for objects, transformations, promises,
       punishments, and rescues.
2. [ ] Add a small gallery of saved query examples and expected outputs.
3. [ ] Add an `ASK` natural-language query demo over the graph.

## Acknowledgements

This project is possible thanks to [Project Gutenberg](https://www.gutenberg.org/)
and the volunteers who digitised, proofread, and released this collection into
the public domain.

- **Corpus source**: <https://www.gutenberg.org/cache/epub/2591/pg2591.txt>
- **eBook #2591** — *Grimms' Fairy Tales*, Jacob & Wilhelm Grimm
- **Edition credits**: Emma Dudding, John Bickers, Dagny, David Widger
- **Release date**: April 1, 2001

## License

- Repo code: MIT.
- Corpus: public domain (see Project Gutenberg license).
