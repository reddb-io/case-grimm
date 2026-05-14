# Grimm Fairy Tales as a Multi-Model RedDB Showcase

Fairy tales look simple until you try to ask them precise questions.

Who is the predator when the predator is not a wolf? Which forests behave
like thresholds rather than scenery? Which stories reuse the same machinery
of abandonment, deception, rescue, punishment, and transformation? The Grimm
corpus is full of patterns that readers feel immediately, but that are hard
to materialize as structured data without flattening the stories.

This project turns that problem into a working RedDB showcase.

The gold layer is a curated canonical collection of **206 Grimm tales**. Each
tale keeps its readable text, provenance back to book editions, KHM/ATU
metadata, characters, traits, objects, locations, world laws, moral regimes,
Propp-like narrative events, and textual evidence. The embedded RedDB snapshot
then lets the same corpus be explored through graph, tables, KV, timeseries,
and statistics.

## Try It

```bash
./grimm setup
./grimm about
./grimm ask
./grimm query "GRAPH CENTRALITY"
./grimm insights stats
```

Everything above points at the embedded RedDB database in `output/embedded.rdb`.
The server/container path is intentionally separate; the public showcase is
embedded-first.

## What Is Inside?

Current embedded snapshot:

| Model | Collection | What it holds | Rows/entities |
|---|---|---|---:|
| graph | `tales` | tale graph: nodes + edges | 60,458 |
| table | `tale_words` | per-tale word frequencies | 53,946 |
| table | `tale_bigrams` | repeated bigrams | 4,075 |
| table | `tale_vocab` | vocabulary richness by tale | 206 |
| time series | `ingest_log` | ingest timings and counters | 2,599 |
| KV | `kv_default` | corpus-level metadata | 6 |
| hll/filter/sketch | `vocab_hll`, `word_filter`, `word_sketch` | probabilistic experiment surface | 0 |

Graph load:

| Thing | Count |
|---|---:|
| canonical tales | 206 |
| graph nodes | 14,256 |
| graph edges | 46,202 |
| trait nodes | 6,126 |
| Propp event nodes | 2,355 |
| character nodes | 1,563 |

## Questions The Corpus Can Answer

The README is intentionally question-first. Each section below gives the
answer first, then the command that reproduces it.

### Q1. Which predators play the same narrative role across species?

**Answer:** predator is a narrative job, not just a species. A wolf, a fox,
a cannibal band, a witch, an old man, or a bird of prey can all occupy the
same structural role when the graph says they share `arc_predator`.

```bash
./grimm ask predators
```

Sample output:

```text
fox_geese_fox                  The Fox
strange_musician_wolf          The Wolf
wolf_man_wolf                  The Wolf
cat_in_partnership             The Cat
fox_geese_fox                  The Fox
strange_musician_wolf          The Wolf
wolf_man_wolf                  The Wolf
frau_trude                     Frau Trude
seven_kids_wolf                The Wolf
hansel_gretel_witch            The Cannibal Witch in the Edible House
```

RedDB used: graph + statistics over character fingerprints.

### Q2. Which tales share the same narrative machinery?

**Answer:** Cinderella's closest structural neighbors are not only other
princess stories. The graph links it to tales with cruel stepfamilies, false
brides, oppressed maidens, repeated trials, birds, houses, trees, and the
symbolic numbers two and three.

```bash
./grimm ask tale-machinery
```

Sample output:

```text
26.5%  the_three_little_men_in_the_forest
25.0%  the_juniper_tree
22.9%  frau_holle
21.2%  allerleirauh_all_kinds_of_fur
20.0%  hansel_and_gretel
```

RedDB used: graph-derived fingerprints + statistics.

### Q3. Can raw word tables ground a narrative pattern?

**Answer:** the structured graph says wolves matter; the word table lets us
check where wolf-language concentrates in the text itself.

```bash
./grimm ask devouring-words
```

Sample output:

```text
the_two_brothers                    18
little_red_cap                      18
the_wolf_and_the_seven_young_kids   17
the_wolf_and_the_fox                17
old_sultan                          11
thumbling                           11
```

RedDB used: `tale_words` table.

### Q4. What is structurally central in the corpus?

**Answer:** the most connected parts of the corpus are not just famous
characters. The center is made of reusable story machinery: traits, narrative
functions, appearances, agency, locations, and Propp events.

```bash
./grimm insights stats
```

Sample output:

```text
top edge labels:
HAS_TRAIT                 6,851
HAS_NARRATIVE_FUNCTION    4,710
APPEARS_IN                3,824
GAINS_AGENCY_THROUGH      3,313
HAS_LOCATION              2,414
HAS_PROPP_EVENT           2,355
```

RedDB used: graph + derived statistics.

### Q5. How does one tale unfold as narrative functions?

**Answer:** a tale can be read as prose, but also as an ordered chain of
events. In *Hansel and Gretel*, the witch's imprisonment scene is materialized
as a Propp event with actor, function, scene, and evidence.

```bash
./grimm ask propp-hansel
```

Sample output:

```text
propp_order      9
propp_function   func_villainy
actor            hansel_gretel_witch
scene            witch imprisons Hansel, fattens him, and forces Gretel to cook
```

RedDB used: graph node properties + `MATCH`.

### Q6. Which books feed a canonical tale?

**Answer:** the gold text is canonical, but not source-less. *Hansel and
Gretel* keeps references to multiple book versions, including source title,
book id, match method, and whether that source is the canonical base.

```bash
./grimm ask provenance
```

Sample output:

```text
pg5314-grimm-hunt      canonical      Hansel and Gretel     match: slug
pg2591-grimm-taylor    supplementary  HANSEL AND GRETEL     match: slug
pg11027-grimm-gruelle  supplementary  HANSEL AND GRETHEL    match: khm
pg52521-grimm-olcott   supplementary  HAENSEL AND GRETHEL   match: khm
```

RedDB used: KV/corpus metadata for the snapshot, gold corpus data for
editorial provenance.

### Q7. What did the ingest write, and how expensive was it?

**Answer:** the demo records its own ingestion work. `ingest_log` stores
batch timings and counters as time-series rows, so the corpus can explain how
it was built.

```bash
./grimm ask ingest
```

Sample metrics:

```text
nodes_batch_ms
nodes_inserted
edges_batch_ms
edges_inserted
edges_total_ms
ingest_total_ms
```

RedDB used: timeseries + KV.

## Visual Docs

The Docsify site is the visual side of the showcase:

```bash
./grimm export docs
./grimm docs serve
```

It is designed around two voices:

- editorial exploration: read the gold tale, inspect source versions, and
  connect the prose back to structured facets;
- analytical exploration: visual atlas, corpus questions, graph statistics,
  RedDB feature pages, and generated data exports.

`docs/data/*.json` is generated, not committed. GitHub Actions rebuilds the
embedded snapshot, exports the static JSON, and publishes `docs/` to Pages.

## Pipeline

```text
input/1-bronze    raw Project Gutenberg books
input/2-silver    extracted books, source texts, canonical texts, branches
input/3-gold      curated 206-tale canonical graph + corpus metadata
output/embedded.rdb
docs/data/*.json  generated visual docs data
```

Useful commands:

```bash
./grimm rebuild          # build corpus, validate, ingest words, ingest graph
./grimm export docs      # generate docs/data JSON
./grimm read hansel-and-gretel
./grimm query "SELECT COUNT(*) FROM tale_vocab"
./grimm insights words --word wolf
```

## Project Map

| Path | Purpose |
|---|---|
| `grimm` | root CLI entry point |
| `src/embedded` | embedded RedDB ingestion, query, insights, export |
| `src/shared` | graph loading and SQL helpers |
| `scripts` | gold validation and corpus build scripts |
| `input/3-gold` | canonical curated dataset |
| `docs` | Docsify site and generated visual experience |
