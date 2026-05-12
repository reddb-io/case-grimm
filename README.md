# Grimms' Fairy Tales — a Queryable Folklore Graph

> *"Cinderella is structurally the miller's daughter from Rumpelstiltskin
> at 63.6%."* — a fact this repo will tell you in 30 ms.

A live, queryable knowledge graph of the **62 Grimms' Fairy Tales** built on
[RedDB](https://github.com/reddb-io/reddb). Characters, archetypes, themes,
places, magic objects, and symbolic numbers — wired together as **655 nodes
and 1,741 directed edges** — and shipped as a **committed RedDB snapshot** so
you can query the graph the second you clone the repo.

No ingest step. No setup. Open the database, ask folklore questions in SQL.

```bash
git clone <repo> && cd ex-grimms-fairy-tales/src/embedded
pnpm install
pnpm query "GRAPH CENTRALITY"
pnpm sim cinderella 5
```

---

## What the Graph Knows

| | |
|---|---:|
| tales | **62** |
| graph nodes | **655** |
| graph edges | **1,741** |
| characters | 402 |
| magic objects | 116 |
| archetypes | 15 |
| themes | 17 |
| locations | 11 |
| species | 28 |
| symbolic numbers | 4 |

Eight node types, ~30 edge labels, all directed. See
[`input/SCHEMA.md`](./input/SCHEMA.md) for the full schema and
[`input/ONTOLOGY.md`](./input/ONTOLOGY.md) for the tale-agnostic vocabulary.

---

## What the Graph Discovers

These insights aren't hard-coded — they fall out of the ontology + traversal.

| Try | Result |
|-----|--------|
| `pnpm sim cinderella 3` | Cinderella's strongest cross-tale match is the **miller's daughter from *Rumpelstiltskin* at 63.6%**. Shared: `humble_hero`, `oppressed_maiden`, `castle`, `num_3`, `humble_triumph`, `magic_pact`, `test_of_virtue`. |
| `pnpm sim lrc_wolf 4` | The Little Red-Cap wolf matches the Seven Kids wolf at 69.2% — but also the **human cannibal bridegroom** from *The Robber Bridegroom* at 46.7%. Same predator function, different species. |
| `pnpm sim gingerbread_witch 3` | The Hansel & Gretel witch's best cross-tale match is **Old Sanna from *Fundevogel* at 43.8%**: another forest witch / predator / child-cooking pattern. |
| `pnpm sim the_frog_prince_frog 3` | The Frog Prince maps equally to the **Griffin and the enchanted Lion-Prince** in *Lily and the Lion* at 57.1% each. One compact character becomes two roles in another tale. |
| `pnpm query "GRAPH CENTRALITY"` | The most central concepts are not specific princes; they are `arc_humble_hero`, `arc_wise_helper`, `theme_humble_triumph`, `loc_forest`, `arc_trickster`. The skeleton of fairy tale. |
| `pnpm query "SELECT COUNT(*) FROM tales WHERE label = 'DECEIVES'"` | Deception appears **71** times across the corpus. |

---

## How to Use the Graph

Everything goes through `pnpm query "<SQL or GRAPH>"`, which opens the
committed `output/embedded.rdb` and runs your query against the `tales`
collection.

### 1. SQL — count, group, filter

```bash
# Entity distribution by node type
pnpm query "SELECT node_type, COUNT(*) FROM tales WHERE node_type IS NOT NULL GROUP BY node_type"

# Top relationship labels by frequency
pnpm query "SELECT label, COUNT(*) FROM tales WHERE node_type IS NULL GROUP BY label"

# How often does X happen?
pnpm query "SELECT COUNT(*) FROM tales WHERE label = 'DECEIVES'"
pnpm query "SELECT COUNT(*) FROM tales WHERE label = 'KILLS'"
pnpm query "SELECT COUNT(*) FROM tales WHERE label = 'EATS'"
```

| node_type | count |   | label | count |
|---|---:|---|---|---:|
| character | 402 |   | `APPEARS_IN` | 399 |
| magic_object | 116 |   | `IS_ARCHETYPE` | 286 |
| tale | 62 |   | `CONTAINS_THEME` | 253 |
| species | 28 |   | `HAS_MAGIC_OBJECT` | 116 |
| theme | 17 |   | `HAS_LOCATION` | 109 |
| archetype | 15 |   | `IS_SPECIES` | 99 |
| location | 11 |   | `DECEIVES` | 71 |
| symbol_number | 4 |   | `HELPS` | 59 |

### 2. `GRAPH CENTRALITY` — what's structurally important

```bash
pnpm query "GRAPH CENTRALITY"
```

| label | score |
|---|---:|
| `arc_humble_hero` | 49 |
| `arc_wise_helper` | 39 |
| `theme_humble_triumph` | 37 |
| `loc_forest` | 34 |
| `arc_trickster` | 33 |

Reads like a syllabus on what fairy tales are *about*.

### 3. `GRAPH PROPERTIES` — global stats

```bash
pnpm query "GRAPH PROPERTIES"
```

| node_count | edge_count | density | is_connected | is_cyclic |
|---:|---:|---:|---|---|
| 655 | 1741 | 0.00762 | false | true |

### 4. `GRAPH NEIGHBORHOOD` — what's around a node

```bash
pnpm query "GRAPH NEIGHBORHOOD '128' DIRECTION both"
```

Excerpt for node `128` (`theme_humble_triumph`):

| depth | label |
|---:|---|
| 0 | `theme_humble_triumph` |
| 1 | `cinderella_tale` |
| 1 | `hansel_gretel_tale` |
| 1 | `rumpelstiltskin_tale` |
| 1 | `the_golden_goose_tale` |
| 1 | `the_valiant_little_tailor_tale` |

### 5. `GRAPH SHORTEST_PATH` — multi-hop traversal

`evil_queen → snow_white`, `lrc_wolf → wsk_wolf`, prince → bride → stepmother
→ witch. Run `pnpm start` to see the full demo suite execute these
automatically.

### 6. `GRAPH COMMUNITY` / `COMPONENTS` / `CYCLES` / `CLUSTERING`

```bash
pnpm query "GRAPH COMMUNITY"
pnpm query "GRAPH COMPONENTS"
```

Each surfaces a different lens on graph structure — natural clusters,
disconnected sub-corpora, recurring cycles, local density.

### 7. `pnpm sim <slug>` — Jaccard similarity over ontology fingerprints

```bash
pnpm sim cinderella 5
pnpm sim hansel
pnpm sim evil_queen
pnpm sim the_blue_light_soldier
pnpm sim cinderella --same-tale 8     # include intra-tale characters
```

Builds a per-character fingerprint of `{archetypes ∪ species ∪ tale themes
∪ tale locations ∪ tale symbolic numbers}` and Jaccard-scores everyone
against it. Excludes same-tale candidates by default so cross-tale
narrative parallels surface. Full math + examples in
[`src/embedded/README.md`](./src/embedded/README.md).

### 8. `pnpm insights <command>` — 21-command analytics CLI

Full folklore-analytics CLI built with [`cli-args-parser`](https://www.npmjs.com/package/cli-args-parser) —
auto help, validation, completion. See [INSIGHTS.md](./INSIGHTS.md) for the
full menu and example outputs. Highlights:

```bash
pnpm insights cooc theme                          # theme co-occurrence matrix
pnpm insights prey                                # every EATS edge
pnpm insights triangles                           # 3-cycles in narrative graph
pnpm insights bridges                             # articulation points (Tarjan)
pnpm insights pagerank                            # weighted PageRank
pnpm insights weirdest -n 10                      # rarest fingerprints
pnpm insights subgraph PREDATION                  # edge-typed slice + centrality

pnpm insights find theme:devouring loc:forest     # hybrid filter, returns table+subgraph
pnpm insights recommend cinderella                # similar tales
pnpm insights path cinderella snow_white          # shortest path between any 2 nodes
pnpm insights explain cinderella                  # full dossier on a node
pnpm insights match arc_predator sp_wolf theme_forest_danger
pnpm insights stats                               # degree distribution, percentiles
```

### 9. `pnpm insights cypher "<pattern>"` — graph-notation queries

```bash
pnpm insights cypher "(a)-[:DECEIVES]->(b) RETURN a, b"
pnpm insights cypher "(a)-[:EATS]->(b)-[:APPEARS_IN]->(t) RETURN a, b, t"
pnpm insights cypher "(a:character)-[:IS_ARCHETYPE]->(b {label:'arc_predator'}) RETURN a"
```

Subset Cypher pattern matcher: labeled edges, reverse direction (`<-`),
node-type filters (`:character`), label filters (`{label:'…'}`), multi-hop
traversals. See [INSIGHTS.md § Graph Notation](./INSIGHTS.md#graph-notation--cypher-subset).

### 10. `pnpm insights logs` — timeseries collection

The ingest process writes per-batch metrics to a **`ingest_log` TIMESERIES
collection** living in the same `.rdb` file as the graph:

```bash
pnpm insights logs                                # summary by metric
pnpm insights logs --metric nodes_batch_ms -n 7   # last 7 points
```

| metric | count | avg | min | max |
|---|---:|---:|---:|---:|
| `nodes_batch_ms` | 7 | 149 | 85 | 175 |
| `edges_batch_ms` | 35 | 219 | 165 | 257 |
| `ingest_total_ms` | 1 | 8996 | 8996 | 8996 |

Showcases RedDB's multi-model engine — **graph + timeseries side-by-side**,
one connection, one SQL surface. See
[INSIGHTS.md § Multi-Model](./INSIGHTS.md#multi-model-timeseries--graph-in-one-database).

---

## Stack

- **[RedDB](https://github.com/reddb-io/reddb)** — multi-model engine (graph
  + document + vector) with SQL/GRAPH query layer.
- **TypeScript / Node** — ingestion + query scripts.
- **pnpm** — package manager.

Two run modes:

| Example | When to use | Stack | DB file |
|---|---|---|---|
| [`src/embedded`](./src/embedded) | local scripts, ETL, single-process | `@reddb-io/sdk` over stdio JSON-RPC | `output/embedded.rdb` |
| [`src/server`](./src/server)   | multi-client, containers, remote   | Docker + HTTP / RedWire / gRPC      | `output/server.rdb`   |

Same corpus, same `tales` collection, same query API — only `connect()`
differs.

---

## Layout

```
.
├── input/                  # corpus + curated graph data — see input/SCHEMA.md
│   ├── BOOKS.txt           # raw Gutenberg corpus (62 tales)
│   ├── TALES.json          # manifest: every tale + modelled status
│   ├── SCHEMA.md           # node types, edge labels, conventions
│   ├── ONTOLOGY.md         # tale-agnostic vocabulary definitions
│   ├── ontology.json       # loader-consumable mirror of ONTOLOGY.md
│   └── tales/
│       ├── <slug>.txt      # tale body sliced from BOOKS.txt
│       └── <slug>.json     # graph data (nodes + edges) for that tale
├── src/
│   ├── shared/             # recursive loader + dedupe (load-graph.ts)
│   ├── embedded/           # RedDB in-process via @reddb-io/sdk
│   └── server/             # RedDB as Docker server + HTTP/Wire/gRPC client
├── output/                 # committed snapshots: embedded.rdb, server.rdb
└── README.md
```

The loader walks `input/` recursively. Any `*.json` with a `collection`
field is treated as graph data; nodes are deduped by `label` so shared
ontology entries (archetypes, themes) are inserted once across all tales.

---

## Adding a Tale

1. Drop `input/tales/<slug>.json` matching the format in [`SCHEMA.md`](./input/SCHEMA.md).
2. Flip the entry in `TALES.json` to `"modelled": true` and point `data_file` at it.
3. Delete `output/embedded.rdb` and run `pnpm start` to re-ingest.

No code changes needed. Coverage today: **62 / 62 tales modelled**.

---

## Roadmap

1. [ ] Curated edges for transformations, promises, punishments, rescues.
2. [ ] Saved query gallery with expected outputs.
3. [ ] `ASK` — natural-language query demo over the graph.

---

## Acknowledgements

Built on [Project Gutenberg](https://www.gutenberg.org/)'s digitisation of
*Grimms' Fairy Tales* (eBook #2591, Jacob & Wilhelm Grimm).
Edition credits: Emma Dudding, John Bickers, Dagny, David Widger.
Released April 1, 2001.

- Corpus: <https://www.gutenberg.org/cache/epub/2591/pg2591.txt>

## License

- Repo code: MIT.
- Corpus: public domain (Project Gutenberg).
