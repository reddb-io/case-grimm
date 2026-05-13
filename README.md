# Grimms' Fairy Tales — A Multi-Model RedDB Showcase

> *"Cinderella is structurally the miller's daughter from Rumpelstiltskin
> at 63.6%."* — a fact this repo will tell you in 30 ms.

A live, queryable knowledge graph of the **62 Grimms' Fairy Tales** built
on [RedDB](https://github.com/reddb-io/reddb). Characters, archetypes,
themes, places, magic objects, and symbolic numbers — wired together as
**655 nodes and 1,741 directed edges** — shipped as a **committed RedDB
snapshot** so you can query the graph the second you clone the repo.

This repo doubles as a **multi-model showcase** for RedDB. The same `.rdb`
file holds, side by side:

- 🕸️  **graph** (`tales`) — the curated folklore graph
- ⏱️  **timeseries** (`ingest_log`) — per-batch ingestion metrics
- 🔑 **KV** (`kv_default`) — corpus metadata
- 📄 **tables** (`tale_words`, `tale_bigrams`, `tale_vocab`) — text analytics
- 🎲 **probabilistic** (`vocab_hll`, `word_sketch`, `word_filter`) — HLL / count-min / bloom
- 🔍 **cypher** pattern-matcher (TS subset, native MATCH coming)

No ingest step. No setup. One `db.query()` surface for all of it.

```bash
git clone <repo> && cd ex-grimms-fairy-tales/src/embedded
pnpm install
pnpm insights about           # what's in the .rdb file
pnpm insights cypher "(a)-[:DECEIVES]->(b) RETURN a, b"
pnpm sim cinderella 5
```

For known engine quirks and limitations encountered while building this,
see [`../feedbacks.md`](../feedbacks.md).

---

## What's in the Snapshot

```bash
pnpm insights about
```

```
=== Corpus metadata (KV collection — keys with `:` are stored with `_`) ===

key                       value
corpus_version            1.0.0
corpus_total_tokens       34717
corpus_tales              62
corpus_unique_vocab       4674
corpus_source             https://www.gutenberg.org/cache/epub/2591/pg2591.txt
corpus_last_ingest_at     1778630037637

=== Collections in this database (SHOW COLLECTIONS) ===

name           model         entities
ingest_log     time_series      89
kv_default     kv                6
tale_bigrams   table          1617
tale_vocab     table            62
tale_words     table         18789
tales          graph          2396
vocab_hll      table          4674
word_filter    table          4674
word_sketch    table         34717
```

Nine collections, five distinct models, one connection.

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
| content tokens | 34,717 |
| unique words | 4,674 |

See [`input/SCHEMA.md`](./input/SCHEMA.md) for the full graph schema and
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
| `pnpm insights correlate -t theme_devouring` | The curated `devouring` theme is independently validated by raw text: top correlated words are `dainty, belly, crushed, devoured, pot, morsel`. |
| `pnpm query "GRAPH CENTRALITY"` | Most central concepts aren't princes; they're `arc_humble_hero`, `arc_wise_helper`, `theme_humble_triumph`, `loc_forest`, `arc_trickster`. |

---

# Feature Tour — Query → Response

Every section below shows the exact command, then the actual output
against the committed snapshot.

## 1. Graph Queries

RedDB's graph module exposes algorithms directly via SQL.

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

```bash
pnpm query "GRAPH PROPERTIES"
```

| node_count | edge_count | density | is_connected | is_cyclic |
|---:|---:|---:|---|---|
| 655 | 1741 | 0.00762 | false | true |

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

Other native commands available: `GRAPH COMMUNITY`, `COMPONENTS`,
`CYCLES`, `CLUSTERING`, `SHORTEST_PATH '<from>' TO '<to>'`, `TRAVERSE`,
`TOPOLOGICAL_SORT`.

```bash
pnpm query "GRAPH SHORTEST_PATH '109' TO '194'"   # evil_queen → snow_white
```

| from | to | hop_count |
|---:|---:|---:|
| 109 | 194 | 1 |

---

## 2. Cypher Vocabulary — Pattern Matching

`pnpm insights cypher "<pattern>"` runs a small Cypher subset over the
graph. Every supported feature, with the response it produces.

> RedDB v1.0.8 parses native `MATCH` but doesn't materialise projections
> yet, so this engine is implemented in TS over the loaded graph. When
> the engine's projection lands, this command will switch to native.

### 2.1 Labeled directional edge

```bash
pnpm insights cypher "(a)-[:DECEIVES]->(b) RETURN a, b" --limit=6
```

```
=== Cypher: (a)-[:DECEIVES]->(b) RETURN a, b — 70 match(es), showing 6 ===

a                       b
cat_and_mouse_cat       cat_and_mouse_mouse
chanticleer             chanticleer_landlord
partlet                 chanticleer_landlord
clever_elsie_hans       clever_elsie
clever_gretel_gretel    clever_gretel_master
clever_gretel_gretel    clever_gretel_guest
```

### 2.2 Any edge, capture relationship

```bash
pnpm insights cypher "(a)-[r]->(b) RETURN a, r, b" --limit=6
```

```
=== Cypher: (a)-[r]->(b) RETURN a, r, b — 509 match(es), showing 6 ===

a                 r                   b
cinderella_tale   CONTAINS_THEME      theme_cruel_stepfamily
cinderella_tale   CONTAINS_THEME      theme_humble_triumph
cinderella_tale   CONTAINS_THEME      theme_test_of_virtue
cinderella_tale   CONTAINS_THEME      theme_magic_pact
cinderella_tale   HAS_MAGIC_OBJECT    obj_hazel_tree
cinderella_tale   HAS_MAGIC_OBJECT    obj_gold_dress
```

### 2.3 Reverse direction `<-`

```bash
pnpm insights cypher "(a)<-[:KILLS]-(b) RETURN a, b" --limit=6
```

```
=== Cypher: (a)<-[:KILLS]-(b) RETURN a, b — 24 match(es), showing 6 ===

a (killed)               b (killer)
chanticleer_landlord     chanticleer_pin
chanticleer_mr_korbes    chanticleer_millstone
fundevogel_sanna         fundevogel_lina
gingerbread_witch        gretel
iron_hans_lost_men       iron_hans
lrc_wolf                 lrc_huntsman
```

### 2.4 Node-type filter `:type`

```bash
pnpm insights cypher "(a:character)-[:IS_ARCHETYPE]->(b {label:'arc_predator'}) RETURN a" --limit=6
```

```
=== Cypher: (a:character)-[:IS_ARCHETYPE]->(b {label:'arc_predator'}) RETURN a — 16 match(es), showing 6 ===

a
cat_and_mouse_cat
chanticleer_mr_korbes
fundevogel_sanna
fundevogel_bird_of_prey
gingerbread_witch
lrc_wolf
```

### 2.5 Node-label filter `{label:'…'}`

```bash
pnpm insights cypher "(t {label:'cinderella_tale'})-[:CONTAINS_THEME]->(theme) RETURN theme"
```

```
=== Cypher: (t {label:'cinderella_tale'})-[:CONTAINS_THEME]->(theme) RETURN theme — 4 match(es) ===

theme
theme_cruel_stepfamily
theme_humble_triumph
theme_test_of_virtue
theme_magic_pact
```

### 2.6 Multi-hop traversal

```bash
pnpm insights cypher "(a)-[:EATS]->(b)-[:APPEARS_IN]->(t) RETURN a, b, t" --limit=6
```

```
=== Cypher: (a)-[:EATS]->(b)-[:APPEARS_IN]->(t) RETURN a, b, t — 13 match(es), showing 6 ===

a (eater)                          b (eaten)            t (tale)
cat_and_mouse_cat                  cat_and_mouse_mouse  cat_and_mouse_in_partnership_tale
lrc_wolf                           lrc_grandmother      little_red_cap_tale
lrc_wolf                           little_red_cap       little_red_cap_tale
the_mouse_the_bird_and_the_sausage_dog ...sausage       the_mouse_the_bird_and_the_sausage_tale
the_robber_bridegroom_robbers      ..._dead             the_robber_bridegroom_tale
wsk_wolf                           kid_1                wolf_seven_kids_tale
```

### 2.7 Three-generation chain (only one in the corpus)

```bash
pnpm insights cypher "(c)-[:CHILD_OF]->(p)-[:CHILD_OF]->(g) RETURN c, p, g"
```

```
=== Cypher: (c)-[:CHILD_OF]->(p)-[:CHILD_OF]->(g) RETURN c, p, g — 1 match(es) ===

c (grandchild)                          p (parent)                       g (grandparent)
the_old_man_and_his_grandson_grandson   the_old_man_and_his_grandson_son the_old_man_and_his_grandson_old_man
```

The only literal three-generation chain in the entire corpus is *The
Old Man and His Grandson* — the graph found it in a single line of pattern.

### 2.8 Type + label compound — "every tale with a forest"

```bash
pnpm insights cypher "(t:tale)-[:HAS_LOCATION]->(loc {label:'loc_forest'}) RETURN t" --limit=8
```

```
=== Cypher: (t:tale)-[:HAS_LOCATION]->(loc {label:'loc_forest'}) RETURN t — 20 match(es), showing 8 ===

t
hansel_gretel_tale
fundevogel_tale
iron_hans_tale
the_blue_light_tale
…
```

---

## 3. SQL Aggregates

```bash
pnpm query "SELECT node_type, COUNT(*) FROM tales WHERE node_type IS NOT NULL GROUP BY node_type"
```

| node_type | COUNT(*) |
|---|---:|
| character | 402 |
| magic_object | 116 |
| tale | 62 |
| species | 28 |
| theme | 17 |
| archetype | 15 |
| location | 11 |
| symbol_number | 4 |

```bash
pnpm query "SELECT label, COUNT(*) FROM tales WHERE node_type IS NULL GROUP BY label ORDER BY COUNT(*) DESC LIMIT 8"
```

| label | COUNT(*) |
|---|---:|
| `APPEARS_IN` | 399 |
| `IS_ARCHETYPE` | 286 |
| `CONTAINS_THEME` | 253 |
| `HAS_MAGIC_OBJECT` | 116 |
| `HAS_LOCATION` | 109 |
| `IS_SPECIES` | 99 |
| `CHILD_OF` | 75 |
| `DECEIVES` | 71 |

---

## 4. KV — Corpus Metadata

Written via the SDK during ingest:

```ts
await db.kv.put('corpus:version', '1.0.0')
await db.kv.put('corpus:total_tokens', 34717)
```

> **Quirk:** RedDB normalises `:` to `_` in KV keys at storage time. Query
> with the underscore form. See [`../feedbacks.md`](../feedbacks.md).

```bash
pnpm query "SELECT key, value FROM kv_default WHERE key LIKE 'corpus%'"
```

```
key                       value
corpus_version            1.0.0
corpus_total_tokens       34717
corpus_tales              62
corpus_unique_vocab       4674
corpus_source             https://www.gutenberg.org/cache/epub/2591/pg2591.txt
corpus_last_ingest_at     1778630037637
```

---

## 5. Timeseries — `ingest_log`

`pnpm start` creates a native **TIMESERIES** collection and writes
per-batch metrics. Native columns: `metric`, `value`, `tags`, `timestamp`.

```ts
await db.query('CREATE TIMESERIES ingest_log')
await db.query(`INSERT INTO ingest_log (metric, value, tags, timestamp)
                VALUES ('nodes_batch_ms', 175, '{"phase":"nodes","batch":0}', 1778627730162)`)
```

```bash
pnpm insights logs
```

```
=== Ingest log — summary by metric ===

metric             COUNT  SUM    AVG     MIN  MAX
edges_batch_ms      35   7679   219.40  165  257
edges_total_ms       1   7837  7837    7837 7837
nodes_inserted       7    655    93.57   55  100
nodes_total_ms       1   1093  1093    1093 1093
nodes_total          1    655   655     655  655
edges_inserted      35   1741    49.74   41   50
edges_total          1   1741  1741    1741 1741
nodes_batch_ms       7   1045   149.29   85  175
ingest_total_ms      1   8996  8996    8996 8996
```

```bash
pnpm insights logs --metric nodes_batch_ms -n 7
```

```
=== Last 7 points for metric 'nodes_batch_ms' ===

timestamp        value
1778627731075     85
1778627730983    169
1778627730806    155
1778627730646    150
1778627730490    156
1778627730324    155
1778627730162    175
```

Direct SQL over a timeseries:

```bash
pnpm query "SELECT metric, AVG(value), MAX(value) FROM ingest_log WHERE metric = 'edges_batch_ms' GROUP BY metric"
```

```
metric           AVG(value)  MAX(value)
edges_batch_ms        219.4         257
```

---

## 6. Statistics

```bash
pnpm insights stats
```

```
=== Graph statistics ===

degree (per node, undirected):
  n=653  sum=3482  min=1  p50=3  p90=13  p99=29  max=49  mean=5.33  stddev=6.07

degree histogram:
  1       180 nodes
  2-3     163
  4-7     176
  8-15     88
  16-31    40
  32-63     6

archetypes per character:
  n=402  min=0  p50=1  p90=2  max=3  mean=0.71

themes per tale:
  n=62  min=1  p50=4  p90=6  max=7  mean=4.08

characters per tale:
  n=62  min=2  p50=6  p90=9  max=14  mean=6.43

pair-wise tale theme Jaccard:
  n=1891  min=0  p50=0.20  p90=0.50  p99=0.75  max=1.00  mean=0.237
```

Tail-heavy degree distribution (power-law-ish): 180 nodes have degree
1, six hubs carry 32–63 connections. Mean pair-wise tale theme overlap
is **24%** — internally consistent but not repetitive.

---

## 7. Text Analytics

`pnpm ingest:words` tokenises every `input/tales/<slug>.txt`, strips
stopwords, and populates `tale_words (tale, word, freq)`, `tale_bigrams
(tale, bigram, freq)`, `tale_vocab (tale, total_tokens, unique_words)`.

```bash
pnpm insights words
```

```
=== Top 15 content words across the corpus ===

word        total_freq   in_tales
king               362         29
man                226         42
time               199         57
day                185         52
father             183         29
home               180         51
himself            171         45
soon               157         51
cried              153         47
mother             153         26
wife               151         32
way                146         50
once               145         56
door               132         38
fell               130         47
```

```bash
pnpm insights words --word wolf
```

```
=== Tales where 'wolf' appears ===

freq  tale
  18  little-red-cap
  18  the-wolf-and-the-seven-little-kids
  13  old-sultan
  10  tom-thumb
   6  the-willow-wren-and-the-bear
   5  the-wedding-of-mrs-fox
   1  chanticleer-and-partlet
```

Plain SQL works too:

```bash
pnpm query "SELECT word, SUM(freq), COUNT(*) FROM tale_words GROUP BY word ORDER BY SUM(freq) DESC LIMIT 5"
```

### Bigrams

```bash
pnpm insights ngrams -n 10
```

```
=== Top 10 bigrams across the corpus ===

bigram              total_freq  in_tales
once upon              42          42
upon time              42          42
king's daughter        16           7
old woman              14          11
home father            10           5
golden bird             8           1
…
```

"once upon" + "upon time" both at 42 → the corpus opens with "once
upon a time" in every single tale.

### Text ↔ Curated-Theme Correlation

The payoff of having both raw text *and* curated graph: cross-link them.
For each theme, find content words whose tale-membership correlates
most strongly with theme membership.

```bash
pnpm insights correlate --theme theme_devouring -n 10
```

```
=== theme_devouring — top 10 content words (lift = P(w|theme) / P(w|¬theme)) ===

word           lift    pos  neg
dainty         33.33     4    0
belly          25         3    0
crushed        25         3    0
devoured       25         3    0
pot            25         3    0
mouse          20.83      5    1
morsel         16.67      2    0
shelf          16.67      2    0
partnership    16.67      2    0
carter         16.67      2    0
```

The curated `theme_devouring` is **independently validated by the raw
text**: `dainty`, `belly`, `crushed`, `devoured`, `pot`, `morsel` —
cooking/eating vocabulary, zero appearances outside theme-bearing tales.
The ontology and the text agree.

### Vocabulary Richness

```bash
pnpm insights richness
```

Top 5 by unique-word count + type-token ratio:

| tale | total | unique | ttr |
|---|---:|---:|---:|
| the_valiant_little_tailor | 1729 | 686 | 0.397 |
| the_three_languages | 1455 | 583 | 0.401 |
| iron_hans | 1392 | 552 | 0.397 |
| the_water_of_life | 1187 | 502 | 0.423 |
| jorinda_and_jorindel | 950 | 446 | 0.470 |

---

## 8. Similarity — Two Lenses

### Jaccard

```bash
pnpm sim cinderella 5
```

Builds a per-character fingerprint of `{archetypes ∪ species ∪ tale themes
∪ tale locations ∪ tale symbolic numbers}` and Jaccard-scores everyone
against it (defaults to cross-tale only). Full math + cool examples in
[`src/embedded/README.md`](./src/embedded/README.md).

### Cosine (TS-side, complement)

```bash
pnpm insights cosine lrc_wolf -n 8
```

```
=== Cosine similarity to 'lrc_wolf' (TS impl; Jaccard shown for comparison) ===

label                              tale                      cosine  jaccard
wsk_wolf                           wolf_seven_kids_tale       0.818    0.692
old_sultan_wolf                    old_sultan_tale            0.684    0.500
tom_thumb_wolf                     tom_thumb_tale             0.640    0.462
the_robber_bridegroom_groom        the_robber_bridegroom_t…   0.636    0.467
the_robber_bridegroom_robbers      the_robber_bridegroom_t…   0.572    0.400
tom_thumb_thieves                  tom_thumb_tale             0.570    0.385
the_willow_wren_and_the_bear_wolf  the_willow_wren…           0.539    0.333
```

Cosine and Jaccard agree on the top match but cosine boosts characters
with smaller fingerprints; Jaccard penalises them harder.

> RedDB v1.0.8 lists `VECTOR` as a parser keyword but `CREATE VECTOR` is
> rejected. When the engine surfaces vector collections, this command
> will be replaced with a native call — see [`../feedbacks.md`](../feedbacks.md).

---

## 9. Probabilistic Structures — HLL / SKETCH / FILTER

`pnpm ingest:words` creates three engine-native probabilistic collections.
DDL is one-liner each:

```ts
await db.query('CREATE HLL vocab_hll')
await db.query('CREATE SKETCH word_sketch')   // defaults: width=1000, depth=5
await db.query('CREATE FILTER word_filter')   // default capacity=100000
```

They appear in `SHOW COLLECTIONS` and accept `INSERT INTO <name> (value)
VALUES (…)`:

```bash
pnpm query "SHOW COLLECTIONS"
```

| name | model | entities |
|---|---|---:|
| vocab_hll | table | 4674 |
| word_sketch | table | 34717 |
| word_filter | table | 4674 |

> v1.0.8 limitation: the engine accepts the DDL and writes, but query-time
> *interrogation* (cardinality estimate, frequency lookup, membership
> check) isn't surfaced through the SDK yet. We populate them to prove
> the engine supports the collection types; `pnpm insights words` /
> `richness` / `ngrams` provide the equivalent functionality via
> ordinary tables. See [`../feedbacks.md`](../feedbacks.md).

---

# `pnpm insights` — Full CLI

Built on [`cli-args-parser`](https://www.npmjs.com/package/cli-args-parser):
schema-driven positional+options, auto help, validation, shell completion.
**27 subcommands.**

```bash
pnpm insights                      # full help
pnpm insights <command> --help     # per-command help
```

| group | command | purpose |
|---|---|---|
| **graph algorithms** | `cooc <kind>` | co-occurrence matrices (archetype / theme / theme-archetype / number-theme) |
|  | `prey` | predator-prey table (every `EATS` edge) |
|  | `triangles` | 3-cycles in the narrative subgraph |
|  | `reach <slug>` | k-hop blast radius from a node |
|  | `bridges` | articulation points (Tarjan) |
|  | `pagerank` | weighted PageRank (narrative 3×, classification 1×) |
|  | `weirdest` | characters with the rarest fingerprints |
|  | `subgraph <KIND>` | edge-typed subgraph + degree centrality |
| **hybrid search** | `find <filters>` | characters matching ALL ontology filters |
|  | `recommend <tale>` | top-8 similar tales by shared themes/archetypes |
|  | `path <a> <b>` | shortest path between two nodes |
|  | `explain <slug>` | full dossier on a node |
|  | `trope <slug>` | dossier on an ontology node (theme/arc/loc/num) |
|  | `match <fp>` | rank characters against a synthetic fingerprint |
|  | `pattern <LABEL>` | every `(X)-[LABEL]->(Y)` match |
| **corpus views** | `timeline` | themes per tale in manifest order |
|  | `roleswap` | archetype vs species mismatches |
|  | `lineage <obj>` | magic object across tales |
| **multi-model** | `logs` | timeseries query |
|  | `stats` | percentiles, histograms, share |
|  | `cypher <pattern>` | Cypher pattern matcher (Section 2) |
| **text analytics** | `words [-t X][-w Y]` | content-word frequencies |
|  | `correlate [-t X]` | text ↔ curated theme lift |
|  | `richness` | vocab size / type-token ratio per tale |
|  | `ngrams -n N` | top bigrams |
|  | `cosine <slug>` | cosine vs Jaccard similarity |
|  | `about` | KV metadata + collection list |

Highlights:

```bash
pnpm insights cooc theme                          # theme co-occurrence matrix
pnpm insights triangles                           # 3-cycles in narrative graph
pnpm insights bridges                             # articulation points
pnpm insights pagerank                            # weighted PageRank
pnpm insights find theme:devouring loc:forest     # hybrid filter
pnpm insights recommend cinderella                # similar tales
pnpm insights path cinderella snow_white          # shortest path
pnpm insights explain cinderella                  # full dossier
pnpm insights match arc_predator sp_wolf theme_forest_danger
```

### `pnpm insights find` — hybrid filter (returns table + subgraph)

```bash
pnpm insights find theme:devouring loc:forest
```

Returns a flat table of characters whose tale carries **both** the
filters, plus an ASCII subgraph linking matches to the ontology nodes:

```
=== Matches for filter [theme_devouring, loc_forest] — 36 characters ===

subgraph:
  fundevogel_sanna  --[tale:theme_devouring]-->  theme_devouring
  fundevogel_sanna  --[tale:loc_forest]-->       loc_forest
  hansel            --[tale:theme_devouring]-->  theme_devouring
  hansel            --[tale:loc_forest]-->       loc_forest
  …
```

### `pnpm insights path` — shortest path

```bash
pnpm insights path cinderella snow_white
```

```
=== Shortest path: cinderella → snow_white (4 hops) ===

hop  from              label           to
  1  cinderella        APPEARS_IN      cinderella_tale
  2  cinderella_tale   HAS_LOCATION    loc_castle
  3  loc_castle        HAS_LOCATION    snow_white_tale
  4  snow_white_tale   APPEARS_IN      snow_white

chain:
  cinderella  --[APPEARS_IN]-->  cinderella_tale  --[HAS_LOCATION]-->  loc_castle  --[HAS_LOCATION]-->  snow_white_tale  --[APPEARS_IN]-->  snow_white
```

Heroines connect through `loc_castle`.

---

## Stack

- **[RedDB](https://github.com/reddb-io/reddb)** — multi-model engine
  (graph + timeseries + KV + tables + probabilistic).
- **TypeScript / Node** — ingestion + query scripts.
- **[`cli-args-parser`](https://www.npmjs.com/package/cli-args-parser)** —
  schema-driven CLI for `pnpm insights`.
- **pnpm** — package manager.

Two run modes:

| Example | When to use | Stack | DB file |
|---|---|---|---|
| [`src/embedded`](./src/embedded) | local scripts, ETL, single-process | `@reddb-io/sdk` over stdio JSON-RPC | `output/embedded.rdb` |
| [`src/server`](./src/server)     | multi-client, containers, remote   | Docker + HTTP / RedWire / gRPC      | `output/server.rdb`   |

Same corpus, same `tales` collection, same query API — only `connect()`
differs.

---

## Layout

```
.
├── input/                  # corpus + curated graph data
│   ├── BOOKS.txt           # raw Gutenberg corpus (62 tales)
│   ├── TALES.json          # manifest: every tale + modelled status
│   ├── SCHEMA.md           # node types, edge labels, conventions
│   ├── ONTOLOGY.md         # tale-agnostic vocabulary
│   ├── ontology.json       # loader-consumable mirror
│   └── tales/
│       ├── <slug>.txt      # tale body sliced from BOOKS.txt
│       └── <slug>.json     # graph data for that tale
├── src/
│   ├── shared/             # recursive loader + dedupe
│   ├── embedded/           # RedDB in-process via @reddb-io/sdk
│   │   └── src/
│   │       ├── index.ts        # pnpm start — ingest graph + timeseries
│   │       ├── ingest-words.ts # pnpm ingest:words — text → tables + HLL/SKETCH/FILTER + KV
│   │       ├── query.ts        # pnpm query "..." — raw SQL/GRAPH
│   │       ├── similarity.ts   # pnpm sim <slug> — Jaccard fingerprints
│   │       └── insights.ts     # pnpm insights <cmd> — 27-command CLI
│   └── server/             # RedDB as Docker server + HTTP/Wire/gRPC client
├── output/                 # committed snapshots: embedded.rdb, server.rdb
└── README.md
```

The loader walks `input/` recursively. Any `*.json` with a `collection`
field is graph data; nodes are deduped by `label` so shared ontology
entries are inserted once.

---

## Adding a Tale

1. Drop `input/tales/<slug>.json` matching the format in [`SCHEMA.md`](./input/SCHEMA.md).
2. Flip the entry in `TALES.json` to `"modelled": true` and point `data_file` at it.
3. Delete `output/embedded.rdb*` and run `pnpm start && pnpm ingest:words` to re-ingest.

No code changes needed. Coverage today: **62 / 62 tales modelled**.

---

## Engine Feedback

Building this surfaced a handful of v1.0.8 quirks and gaps — `MATCH`
projection materialisation, `CREATE VECTOR/DOCUMENT` rejection,
HLL/SKETCH/FILTER read-side API, `cache.put` in embedded mode, etc.

Detailed write-up: [`../feedbacks.md`](../feedbacks.md).

---

## Roadmap

1. [ ] Swap TS Cypher engine for native `MATCH` when projection lands.
2. [ ] Native `VECTOR` collection for `cosine` once `CREATE VECTOR` works.
3. [ ] Surface HLL/SKETCH/FILTER estimates when SDK supports it.
4. [ ] `ASK` — natural-language query demo over the graph.

---

## Acknowledgements

Built on [Project Gutenberg](https://www.gutenberg.org/)'s digitisation
of *Grimms' Fairy Tales* (eBook #2591, Jacob & Wilhelm Grimm). Edition
credits: Emma Dudding, John Bickers, Dagny, David Widger. Released
April 1, 2001.

- Corpus: <https://www.gutenberg.org/cache/epub/2591/pg2591.txt>

## License

- Repo code: MIT.
- Corpus: public domain (Project Gutenberg).
