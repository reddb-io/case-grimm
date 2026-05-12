# Insights — Folklore Analytics

A folklore-graph **analysis playground** built on top of the committed RedDB
snapshot. Every subcommand is implemented in
[`src/embedded/src/insights.ts`](./src/embedded/src/insights.ts) and dispatched
through [`cli-args-parser`](https://www.npmjs.com/package/cli-args-parser) —
positional args, options, validation, `--help` and shell completion are all
generated from the schema.

```bash
cd src/embedded
pnpm install
pnpm insights                  # show full help
pnpm insights <command> --help # per-command help
```

All 21 subcommands at a glance:

| group | command | purpose |
|---|---|---|
| **graph algorithms** | `cooc <kind>` | co-occurrence matrices (archetype, theme, theme-archetype, number-theme) |
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
| **multi-model** | `logs` | query the `ingest_log` **timeseries** |
|  | `stats` | descriptive statistics, percentiles, share |
|  | `cypher <pattern>` | subset-Cypher pattern matcher |

---

## Graph Algorithms

### `cooc theme` — what themes ride together

```
pnpm insights cooc theme
```

| theme_a | theme_b | tales |
|---|---|---:|
| `humble_triumph` | `test_of_virtue` | 22 |
| `humble_triumph` | `moral_punishment` | 20 |
| `disguise` | `humble_triumph` | 16 |
| `curse` | `metamorphosis` | 16 |
| `disguise` | `moral_punishment` | 16 |
| `curse` | `test_of_virtue` | 13 |

The folklore engine in two rows: **humility wins, vice is punished** — and
disguise is the device that ties them together.

### `cooc number-theme` — what `3` and `7` actually mean

```
pnpm insights cooc number-theme
```

| number | theme | tales |
|---|---|---:|
| `num_3` | `test_of_virtue` | 17 |
| `num_3` | `humble_triumph` | 15 |
| `num_3` | `metamorphosis` | 12 |
| `num_7` | `moral_punishment` | 6 |
| `num_12` | `curse` | 5 |

`num_3` is the **trial number** — most tales with three of anything are
testing the protagonist's virtue. `num_7` is the **punishment number**;
`num_12` is the **curse number**.

### `prey` — every `EATS` edge

```
pnpm insights prey
```

13 EATS edges, including:

| eater | eaten | tale |
|---|---|---|
| `lrc_wolf` | `lrc_grandmother` | little_red_cap |
| `lrc_wolf` | `little_red_cap` | little_red_cap |
| `wsk_wolf` | `kid_1`–`kid_6` | wolf_seven_kids |
| `tom_thumb_cow` | `tom_thumb` | tom_thumb |
| `the_robber_bridegroom_robbers` | `the_robber_bridegroom_dead` | robber_bridegroom |

### `triangles` — 3-cycles among characters

```
pnpm insights triangles
```

59 found. Highlights:

| a | b | c | tale |
|---|---|---|---|
| Gingerbread Witch | Gretel | Hansel | hansel_gretel |
| Little Red-Cap | Grandmother | Wolf | little_red_cap |
| Little Red-Cap | Huntsman | Wolf | little_red_cap |
| Rapunzel | Dame Gothel | Rapunzel's Father | rapunzel |
| Enchanted Bear (Prince) | Wicked Dwarf | Snow-white | snow_white_and_rose_red |

### `reach cinderella --depth=4`

```
pnpm insights reach cinderella -d 4
```

| depth | nodes |
|---:|---:|
| 0 | 1 |
| 1 | 10 |
| 2 | 70 |
| 3 | 243 |
| 4 | 295 |

**619 / 655** nodes reachable within 4 hops. The graph is nearly fully
connected through her tale's themes.

### `bridges` — articulation points

```
pnpm insights bridges
```

58 articulation points. Top by degree (delete = sub-graph collapse):

| label | name | degree |
|---|---|---:|
| `lily_and_the_lion_tale` | Lily and the Lion | 25 |
| `the_golden_bird_tale` | The Golden Bird | 24 |
| `snow_white_tale` | Snow White | 24 |
| `iron_hans_tale` | Iron Hans | 23 |
| `the_water_of_life_tale` | The Water of Life | 23 |

Most articulation points are **tale nodes**, which makes sense: their
characters dangle off them and would be orphaned without the link.

### `pagerank` — narrative-weighted importance

```
pnpm insights pagerank
```

| label | type | score |
|---|---|---:|
| `theme_humble_triumph` | theme | 0.00496 |
| `theme_moral_punishment` | theme | 0.00379 |
| `loc_forest` | location | 0.00366 |
| `theme_test_of_virtue` | theme | 0.00341 |
| `theme_disguise` | theme | 0.00331 |
| `loc_castle` | location | 0.0031 |
| `the_golden_goose_tale` | tale | 0.00265 |
| `num_3` | number | 0.00259 |
| `arc_humble_hero` | archetype | 0.00258 |
| `mother_goat` | character | 0.00174 |

Note: only one character cracks the top-20 (`mother_goat`). The graph's
"important" nodes are themes and places — the skeleton, not the cast.

### `weirdest` — anti-centroid

```
pnpm insights weirdest -n 10
```

| label | tale | weirdness |
|---|---|---:|
| `partlet` | chanticleer_and_partlet | 61.99 |
| `the_three_languages_frogs` | the_three_languages | 53.09 |
| `the_travelling_musicians_ass` | the_travelling_musicians | 49.78 |
| `the_four_clever_brothers_dragon` | the_four_clever_brothers | 48.26 |
| `the_queen_bee_bee_queen` | the_queen_bee | 43.34 |

The weirdest characters are **animal protagonists** whose tales avoid the
big shared themes (humble triumph, test of virtue). Partlet is the
all-time outlier — a hen at the centre of a tale that does none of the
usual folklore moves.

### `subgraph KINSHIP` — only family edges

```
pnpm insights subgraph KINSHIP
```

Subgraph: 159 edges (`MARRIES + CHILD_OF + SIBLING_OF`), 169 nodes.

Top by degree:

| label | name | degree |
|---|---|---:|
| `the_four_clever_brothers_thief` | Eldest Brother (Thief) | 7 |
| `mother_goat` | Mother Goat | 7 |
| `lily` | Lily | 6 |
| `the_golden_goose_dummling` | Dummling | 6 |
| `the_water_of_life_youngest` | Youngest Prince | 6 |

Centrality changes shape: in KINSHIP space, the eldest-of-four and
mother-of-seven tie. Switch to `PREDATION`, `HELPING`, or `OWNERSHIP`
and a different cast rises.

---

## Hybrid Search

### `find` — filter by ontology bundle

```
pnpm insights find theme:devouring loc:forest
```

Returns a flat table of characters whose tale carries **both** the
`devouring` theme and the `forest` location — plus an ASCII subgraph
linking each character to the required ontology nodes.

```
=== Matches for filter [theme_devouring, loc_forest] — 36 characters ===

(table of slug / name / tale / fp_size omitted)

subgraph:
  fundevogel_sanna  --[tale:theme_devouring]-->  theme_devouring
  fundevogel_sanna  --[tale:loc_forest]-->  loc_forest
  hansel  --[tale:theme_devouring]-->  theme_devouring
  hansel  --[tale:loc_forest]-->  loc_forest
  ...
```

### `recommend cinderella` — similar tales

```
pnpm insights recommend cinderella
```

```
Tale recommendations for 'cinderella_tale' (Cinderella)
  source fingerprint (15): arc_animal_helper, arc_cruel_stepmother, ...

  37.0%  the_juniper_tree_tale            — The Juniper-Tree
  35.7%  the_seven_ravens_tale            — The Seven Ravens
  31.0%  briar_rose_tale                  — Briar Rose
  29.4%  the_goose_girl_tale              — The Goose-Girl
```

### `path` — shortest path between any two nodes

```
pnpm insights path cinderella snow_white
```

```
=== Shortest path: cinderella → snow_white (4 hops) ===

hop  from         label           to                       to_name
  1  cinderella   APPEARS_IN      cinderella_tale          Cinderella
  2  cinderella_tale  HAS_LOCATION  loc_castle             Castle
  3  loc_castle   HAS_LOCATION ←  snow_white_tale          Snow White
  4  snow_white_tale  APPEARS_IN ← snow_white              Snow White

chain:
  cinderella  --[APPEARS_IN]-->  cinderella_tale  --[HAS_LOCATION]-->  loc_castle  --[HAS_LOCATION]-->  snow_white_tale  --[APPEARS_IN]-->  snow_white
```

Heroines connect through `loc_castle`.

### `explain` — full dossier on a node

```
pnpm insights explain cinderella
```

```
=== cinderella (Cinderella) — character ===
  tale: cinderella_tale
  direct (3): arc_humble_hero, arc_oppressed_maiden, sp_human
  fingerprint (8): arc_humble_hero, arc_oppressed_maiden, loc_castle,
                   num_3, theme_cruel_stepfamily, theme_humble_triumph,
                   theme_magic_pact, theme_test_of_virtue

  outgoing narrative:
    --[OPPRESSED_BY]-->  cinderella_stepmother  (Stepmother)
    --[MISTREATED_BY]--> cinderella_stepsister_1
    --[MISTREATED_BY]--> cinderella_stepsister_2
    --[MARRIES]-->       cinderella_prince
    --[PLANTED]-->       obj_hazel_tree

  top 5 cross-tale matches:
    63.6%  rumpelstiltskin_daughter
    60.0%  the_golden_goose_dummling
    60.0%  the_white_snake_princess
```

### `trope theme_devouring` — dossier on an ontology node

```
pnpm insights trope theme_devouring
```

Lists every tale carrying the theme, and the top co-occurring features
in those tales: `theme_forest_danger`, `theme_moral_punishment`,
`arc_predator`, `loc_forest`.

### `match` — synthetic fingerprint matching

```
pnpm insights match arc_predator sp_wolf theme_forest_danger
```

```
   33.3%  lrc_wolf                            — Wolf (Little Red-Cap)
   25.0%  wsk_wolf                            — Wolf (Seven Kids)
   25.0%  tom_thumb_wolf                      — The Hungry Wolf
   20.0%  fundevogel_sanna                    — Old Sanna (the cook-witch)
   18.2%  the_robber_bridegroom_robbers       — Cannibal Robber Band
   16.7%  the_robber_bridegroom_groom         — Cannibal Bridegroom (human!)
```

### `pattern DECEIVES` — list every edge of a given label

```
pnpm insights pattern DECEIVES
```

71 matches: `wolf → grandmother`, `evil_queen → snow_white`,
`miller_daughter → rumpelstiltskin`, etc.

---

## Corpus Views

### `timeline` — themes per tale in publication order

```
pnpm insights timeline
```

| pos | tale | n_themes | themes |
|---:|---|---:|---|
| 1 | the_golden_bird_tale | 6 | curse, disguise, humble_triumph, +3 |
| 2 | hansel_gretel_tale | 5 | abandonment, devouring, forest_danger, +2 |
| 3 | rumpelstiltskin_tale | 4 | broken_promise, humble_triumph, magic_pact, +1 |
| … | | | |

### `roleswap` — character whose archetype contradicts their species

```
pnpm insights roleswap
```

Lists characters who carry predator archetypes despite being human, or
helper archetypes despite being wolves/witches. Surfaces the **role-
function vs. surface-form** decoupling that makes folklore portable.

### `lineage obj_magic_mirror`

```
pnpm insights lineage obj_magic_mirror
```

The Magic Mirror's tales, owners, and co-occurring magic objects across
the corpus.

---

## Multi-Model: Timeseries + Graph in One Database

RedDB is multi-model — the same `.rdb` file holds the `tales` graph **and**
a `ingest_log` **timeseries** collection populated during `pnpm start`.

### Collection schema (timeseries)

```sql
CREATE TIMESERIES ingest_log
-- engine-fixed columns: metric, value, tags (JSON), timestamp
```

### `logs` — read the ingest timeseries

```
pnpm insights logs
```

```
=== Ingest log — summary by metric ===

metric             COUNT  SUM    AVG     MIN  MAX
nodes_batch_ms     7      1045   149.29   85  175
nodes_inserted     7       655    93.57   55  100
edges_batch_ms     35     7679   219.40  165  257
edges_inserted     35     1741    49.74   41   50
nodes_total_ms     1      1093  1093     1093 1093
edges_total_ms     1      7837  7837     7837 7837
ingest_total_ms    1      8996  8996     8996 8996
nodes_total        1       655   655     655  655
edges_total        1      1741  1741     1741 1741
```

Drill into a metric:

```
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

Read these as: 7 chunks of 100 nodes (last one 55) ingested in 85–175ms
each, total 1093 ms. The single source of truth for ingestion performance
lives **inside the database itself** — no external metric store.

You can run aggregates directly via SQL:

```
pnpm query "SELECT metric, AVG(value), MAX(value), MIN(value) FROM ingest_log GROUP BY metric"
```

The script in `src/embedded/src/index.ts` calls `CREATE TIMESERIES
ingest_log` and emits a point per batch — see the `logPoint()` helper.

### `stats` — descriptive statistics

```
pnpm insights stats
```

```
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

Tail-heavy degree distribution (power-law-ish): most nodes have ≤7
neighbours, six hubs carry the structure. Average pairwise tale theme
overlap is **24%** — the corpus is internally consistent but not
repetitive.

---

## Graph Notation — `cypher` Subset

`pnpm insights cypher "<pattern>"` runs a small Cypher-like pattern matcher
over the graph. RedDB v1.0.7's native `MATCH` parses but doesn't materialise
projections, so this engine is a TS implementation for now.

Supported syntax:

| construct | example |
|---|---|
| labeled edge | `(a)-[:DECEIVES]->(b)` |
| any edge | `(a)-[r]->(b)` |
| reverse direction | `(a)<-[:KILLS]-(b)` |
| node-type filter | `(a:character)` |
| node-label filter | `(b {label:'arc_predator'})` |
| chained hops | `(a)-[:L1]->(b)-[:L2]->(c)` |
| RETURN clause | `RETURN a, b, c` |

### Example 1 — every deceiver

```
pnpm insights cypher "(a)-[:DECEIVES]->(b) RETURN a, b"
```

```
=== Cypher: (a)-[:DECEIVES]->(b) RETURN a, b — 71 match(es), showing 25 ===

a                            b
cat_and_mouse_cat            cat_and_mouse_mouse
chanticleer                  chanticleer_landlord
clever_elsie_hans            clever_elsie
clever_gretel_gretel         clever_gretel_master
…
```

### Example 2 — two-hop traversal

```
pnpm insights cypher "(a)-[:EATS]->(b)-[:APPEARS_IN]->(t) RETURN a, b, t"
```

Joins prey to tale in one query — every devouring with its narrative
context:

| a (eater) | b (eaten) | t (tale) |
|---|---|---|
| lrc_wolf | little_red_cap | little_red_cap_tale |
| wsk_wolf | kid_1 | wolf_seven_kids_tale |
| tom_thumb_cow | tom_thumb | tom_thumb_tale |

### Example 3 — find every predator (label filter)

```
pnpm insights cypher "(a:character)-[:IS_ARCHETYPE]->(b {label:'arc_predator'}) RETURN a"
```

16 characters carry the predator archetype: wolves, witches, dragons,
robbers, the Hungry Wolf, the Sea Dragon, the cannibal bridegroom.

---

## Programmatic Access

Every analytics function in `insights.ts` is plain TypeScript over the
loaded graph — import them directly:

```ts
import { connect } from '@reddb-io/sdk'

// graph queries
const db = await connect('file:///path/to/embedded.rdb')
await db.query('GRAPH CENTRALITY')

// timeseries queries (same db, same connection)
await db.query("SELECT metric, AVG(value) FROM ingest_log GROUP BY metric")

await db.close()
```

The whole repo is the "showcase" — both **graph** and **timeseries** models
live in the same `.rdb` file, queried through the same `db.query()` surface.
