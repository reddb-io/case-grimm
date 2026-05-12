# Grimms' Fairy Tales — RedDB Graph Playground

A study repo for experimenting with [RedDB](https://github.com/reddb-io/reddb).
We use the **Grimms' Fairy Tales** corpus (Jacob & Wilhelm Grimm) to build a
graph database that models characters, stories, archetypes, themes, places,
objects — and the relationships between them.

## Acknowledgements

This project is only possible thanks to [Project Gutenberg](https://www.gutenberg.org/)
and the volunteers who digitised, proofread, and released this collection
into the public domain.

- **Corpus source**: <https://www.gutenberg.org/cache/epub/2591/pg2591.txt>
- **eBook #2591** — *Grimms' Fairy Tales*, Jacob & Wilhelm Grimm
- **Edition credits**: Emma Dudding, John Bickers, Dagny, David Widger
- **Release date**: April 1, 2001

Thank you for preserving folklore and keeping it free for everyone.

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

## Stack

- **RedDB** — multi-model engine (graph + document + vector).
- **pnpm** — package manager.
- **TypeScript / Node** — ingestion and query scripts.

## Layout

```
.
├── input/                  # corpus + curated structured data — see input/SCHEMA.md
│   ├── books.txt           # raw Gutenberg corpus
│   ├── tales.json          # manifest of every tale in books.txt + modelled status
│   ├── SCHEMA.md           # graph schema: node types, edge labels, conventions
│   ├── ONTOLOGY.md         # canonical definition of the tale-agnostic vocabulary
│   ├── ontology.json       # loader-consumable mirror of ONTOLOGY.md
│   └── tales/
│       ├── <slug>.txt      # tale body sliced from books.txt
│       └── <slug>.json     # graph data for that tale (modelled only)
├── src/
│   ├── shared/             # shared loader (recursive glob + dedupe)
│   ├── embedded/           # RedDB embedded in-process (@reddb-io/sdk)
│   └── server/             # RedDB as a Docker server + HTTP client
├── output/                 # generated artefacts (embedded.rdb, server.rdb)
└── README.md
```

Folder conventions:

- **`input/`** — the source of truth: raw corpus + every curated graph JSON.
  The loader walks this tree recursively and treats any `.json` file
  containing a `collection` field as graph data. Files without one
  (like `tales.json`) are ignored by the loader.
- **`input/tales.json`** — manifest listing every tale found in `books.txt`,
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

Ask ad hoc SQL/GRAPH questions with `pnpm query`:

```bash
pnpm query "SELECT node_type, COUNT(*) FROM tales WHERE node_type IS NOT NULL GROUP BY node_type"
pnpm query "SELECT label, COUNT(*) FROM tales WHERE node_type IS NULL GROUP BY label"
pnpm query "SELECT COUNT(*) FROM tales WHERE label = 'DECEIVES'"
pnpm query "GRAPH CENTRALITY"
pnpm query "GRAPH PROPERTIES"
pnpm query "GRAPH NEIGHBORHOOD '128' DIRECTION both"
```

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

`input/tales.json` is the authoritative manifest. Today: **62 / 62 tales modelled**.

| status     | tales |
|------------|-------|
| modelled   | all 62 tales from `books.txt` |
| pending    | none |

To add a new tale: drop `input/tales/<slug>.json` following the format
in `SCHEMA.md`, then flip the matching entry in `tales.json` to
`"modelled": true` and point `data_file` at it. No code changes needed.

## Roadmap

1. [ ] Add more curated relationships for objects, transformations, promises,
       punishments, and rescues.
2. [ ] Add a small gallery of saved query examples and expected outputs.
3. [ ] Add an `ASK` natural-language query demo over the graph.

## License

- Repo code: MIT.
- Corpus: public domain (see Project Gutenberg license).
