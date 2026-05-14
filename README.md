# Grimm Fairy Tales x RedDB

<p align="center">
  <strong>A multi-model data showcase built from 206 canonical Grimm tales.</strong><br>
  Graphs, tables, KV, time series, statistics, provenance, and readable stories in one embedded RedDB snapshot.
</p>

<p align="center">
  <a href="https://reddb-io.github.io/ex-grimms-fairy-tales/"><img alt="Live docs" src="https://img.shields.io/badge/live_docs-GitHub_Pages-111827?style=for-the-badge"></a>
  <a href="https://github.com/reddb-io/ex-grimms-fairy-tales/actions/workflows/pages.yml"><img alt="Docs deploy" src="https://img.shields.io/github/actions/workflow/status/reddb-io/ex-grimms-fairy-tales/pages.yml?branch=main&label=docs&style=for-the-badge"></a>
  <img alt="Corpus" src="https://img.shields.io/badge/corpus-206_tales-7c3aed?style=for-the-badge">
  <img alt="Mode" src="https://img.shields.io/badge/mode-embedded_RedDB-059669?style=for-the-badge">
</p>

<p align="center">
  <a href="https://reddb-io.github.io/ex-grimms-fairy-tales/"><strong>Open the visual docs</strong></a>
  &nbsp;|&nbsp;
  <a href="#questions-this-corpus-can-answer">Explore questions</a>
  &nbsp;|&nbsp;
  <a href="#run-it-locally">Run locally</a>
  &nbsp;|&nbsp;
  <a href="#what-reddb-is-doing">RedDB features</a>
</p>

---

Fairy tales look simple until you try to ask them precise questions.

Who is the predator when the predator is not a wolf? Which forests behave like
thresholds rather than scenery? Which stories reuse the same machinery of
abandonment, deception, rescue, punishment, and transformation?

The Grimm corpus is full of patterns that readers feel immediately, but that
are hard to materialize as structured data without flattening the stories. This
project turns that literary problem into a working RedDB showcase.

The gold layer is a curated canonical collection of **206 Grimm tales**. Each
tale keeps readable text, provenance back to book editions, KHM/ATU metadata,
characters, traits, objects, locations, world laws, moral regimes, Propp-like
narrative events, branches, and textual evidence. The embedded RedDB snapshot
then lets the same corpus be explored as graph, tables, KV, time series, and
statistics.

---

## The Pitch

| If you are... | This repo gives you... |
|---|---|
| A developer | A concrete embedded RedDB app with CLI queries, generated docs data, and CI publishing. |
| A researcher | A structured corpus where motifs, characters, provenance, and story functions are queryable. |
| A literary reader | A way to read the tales and compare canonical text against source versions. |
| A database person | A compact demo of multi-model workloads using one local RedDB snapshot. |

## Run It Locally

```bash
./grimm setup
./grimm about
./grimm ask
./grimm query "GRAPH CENTRALITY"
./grimm insights stats
```

Everything above points at the embedded database in `output/embedded.rdb`.
The server/container path is intentionally separate; this showcase is
embedded-first.

## What RedDB Is Doing

| RedDB capability | Where it appears | Why it matters |
|---|---|---|
| Graph | `tales` | Characters, traits, motifs, Propp events, provenance edges, and tale structure. |
| Tables | `tale_words`, `tale_bigrams`, `tale_vocab` | Text evidence, vocabulary, frequency, and lexical exploration. |
| KV | `kv_default` | Snapshot metadata and corpus-level facts. |
| Time series | `ingest_log` | Ingest counters and timing metrics for the build itself. |
| Statistics | centrality, fingerprints, ranked counts | Fast insight surfaces on top of the graph and text tables. |
| Docs export | `docs/data/*.json` | Static visual docs generated from the embedded snapshot in GitHub Actions. |

## Snapshot At A Glance

| Metric | Count |
|---|---:|
| Canonical tales | 206 |
| Graph nodes | 14,256 |
| Graph edges | 46,202 |
| Trait nodes | 6,126 |
| Propp event nodes | 2,355 |
| Character nodes | 1,563 |

| Collection | Model | Rows/entities |
|---|---|---:|
| `tales` | graph | 60,458 |
| `tale_words` | table | 53,946 |
| `tale_bigrams` | table | 4,075 |
| `tale_vocab` | table | 206 |
| `ingest_log` | time series | 2,599 |
| `kv_default` | KV | 6 |

---

## Questions This Corpus Can Answer

The README is intentionally question-first. Each block gives the answer, the
command that reproduces it, and the RedDB surface being exercised.

| Question | Short answer | Try it | RedDB surface |
|---|---|---|---|
| Which predators play the same narrative role across species? | Predator is a narrative job, not just a species. | `./grimm ask predators` | graph + statistics |
| Which tales share the same narrative machinery? | Similarity over fingerprints finds structural neighbors beyond title/theme. | `./grimm ask tale-machinery` | graph + statistics |
| Can raw word tables ground a narrative pattern? | Word frequencies show where motifs concentrate in the prose itself. | `./grimm ask devouring-words` | tables |
| What is structurally central in the corpus? | Centrality surfaces reusable machinery: traits, functions, agency, locations. | `./grimm insights stats` | graph + statistics |
| How does one tale unfold as narrative functions? | A tale becomes an ordered chain of Propp-like events with actors and scenes. | `./grimm ask propp-hansel` | graph |
| Which books feed a canonical tale? | Gold text stays separate from its source editions, while keeping provenance. | `./grimm ask provenance` | KV + gold metadata |
| What did the ingest write, and how expensive was it? | The demo records its own build counters and timing rows. | `./grimm ask ingest` | time series + KV |

### Q1. Which predators play the same narrative role across species?

**Answer:** predator is a narrative job, not just a species. A wolf, a fox, a
cannibal band, a witch, an old man, or a bird of prey can occupy the same
structural role when the graph says they share `arc_predator`.

```bash
./grimm ask predators
```

```text
fox_geese_fox                  The Fox
strange_musician_wolf          The Wolf
wolf_man_wolf                  The Wolf
frau_trude                     Frau Trude
hansel_gretel_witch            The Cannibal Witch in the Edible House
```

### Q2. Which tales share the same narrative machinery?

**Answer:** Cinderella's closest structural neighbors are not only other
princess stories. The graph links it to tales with cruel stepfamilies, false
brides, oppressed maidens, repeated trials, birds, houses, trees, and symbolic
numbers.

```bash
./grimm ask tale-machinery
```

```text
26.5%  the_three_little_men_in_the_forest
25.0%  the_juniper_tree
22.9%  frau_holle
21.2%  allerleirauh_all_kinds_of_fur
20.0%  hansel_and_gretel
```

### Q3. Can raw word tables ground a narrative pattern?

**Answer:** the graph says wolves matter; the word table lets us check where
wolf-language concentrates in the actual text.

```bash
./grimm ask devouring-words
```

```text
the_two_brothers                    18
little_red_cap                      18
the_wolf_and_the_seven_young_kids   17
the_wolf_and_the_fox                17
old_sultan                          11
```

### Q4. What is structurally central in the corpus?

**Answer:** the center is not only famous characters. The corpus center is made
of reusable story machinery: traits, narrative functions, appearances, agency,
locations, and Propp events.

```bash
./grimm insights stats
```

```text
HAS_TRAIT                 6,851
HAS_NARRATIVE_FUNCTION    4,710
APPEARS_IN                3,824
GAINS_AGENCY_THROUGH      3,313
HAS_LOCATION              2,414
HAS_PROPP_EVENT           2,355
```

### Q5. How does one tale unfold as narrative functions?

**Answer:** *Hansel and Gretel* can be read as prose, but also as an ordered
chain of events. The witch's imprisonment scene is materialized as a Propp
event with actor, function, scene, and evidence.

```bash
./grimm ask propp-hansel
```

```text
propp_order      9
propp_function   func_villainy
actor            hansel_gretel_witch
scene            witch imprisons Hansel, fattens him, and forces Gretel to cook
```

### Q6. Which books feed a canonical tale?

**Answer:** the gold text is canonical, but not source-less. *Hansel and
Gretel* keeps references to multiple book versions, including source title,
book id, match method, and whether that source is the canonical base.

```bash
./grimm ask provenance
```

```text
pg5314-grimm-hunt      canonical      Hansel and Gretel     match: slug
pg2591-grimm-taylor    supplementary  HANSEL AND GRETEL     match: slug
pg11027-grimm-gruelle  supplementary  HANSEL AND GRETHEL    match: khm
pg52521-grimm-olcott   supplementary  HAENSEL AND GRETHEL   match: khm
```

### Q7. What did the ingest write, and how expensive was it?

**Answer:** the demo records its own ingestion work. `ingest_log` stores batch
timings and counters as time-series rows, so the corpus can explain how it was
built.

```bash
./grimm ask ingest
```

```text
nodes_batch_ms
nodes_inserted
edges_batch_ms
edges_inserted
edges_total_ms
ingest_total_ms
```

---

## Visual Docs

The [GitHub Pages docs site](https://reddb-io.github.io/ex-grimms-fairy-tales/)
is the visual side of the showcase.

| Mode | What you can do |
|---|---|
| Reader | Read the gold tale in a clean browser view. |
| Sources | Inspect original silver book versions without duplicating files in the repo. |
| Compare | Put canonical text and source text side by side. |
| Atlas | Browse tale stats, facets, graph counts, and corpus-level questions. |
| RedDB | See how graph, table, KV, time-series, and statistics data support the same UX. |

```bash
./grimm export docs
./grimm docs serve
```

`docs/data/*.json` is generated, not committed. GitHub Actions rebuilds the
embedded snapshot, exports the static JSON, verifies the docs payload, and
publishes `docs/` to Pages.

## Pipeline

```text
input/1-bronze    raw Project Gutenberg books
input/2-silver    extracted books, source texts, canonical texts, branches
input/3-gold      curated 206-tale canonical graph + corpus metadata
output/embedded.rdb
docs/data/*.json  generated visual docs data
```

## Useful Commands

| Command | Purpose |
|---|---|
| `./grimm rebuild` | Build corpus metadata, validate gold, ingest words, ingest graph. |
| `./grimm export docs` | Generate `docs/data/*.json` from the embedded snapshot. |
| `./grimm docs serve` | Serve the Docsify site locally. |
| `./grimm read hansel-and-gretel` | Print a canonical gold tale excerpt and provenance. |
| `./grimm query "SELECT COUNT(*) FROM tale_vocab"` | Run a raw query against embedded RedDB. |
| `./grimm insights words --word wolf` | Explore text-table evidence for one word. |

## Project Map

| Path | Purpose |
|---|---|
| `grimm` | Root CLI entry point. |
| `src/embedded` | Embedded RedDB ingestion, query, insights, and docs export. |
| `src/shared` | Graph loading and SQL helpers. |
| `scripts` | Gold validation and corpus build scripts. |
| `input/3-gold` | Canonical curated dataset. |
| `docs` | Docsify site and generated visual experience. |
