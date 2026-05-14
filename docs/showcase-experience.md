# Grimm Showcase Experience Plan

This document captures the product decisions for the public README and
Docsify experience.

## Goals

- Make the Grimm corpus feel valuable before it feels technical.
- Show that fairy-tale imagination can become structured, queryable data.
- Use RedDB as the through-line: graph, tables, KV, timeseries, statistics,
  and derived static docs data.
- Keep the public experience focused on what works in embedded mode.
- Keep engineering feedback and RedDB stress-test notes out of the README and
  public docs narrative.

## Public Entry Point

The root command is the official interface:

```bash
./grimm query "GRAPH CENTRALITY"
./grimm ask predators
./grimm insights stats
./grimm export docs
```

`./grimm` is a thin executable wrapper. The real CLI lives in
`src/embedded/src/grimm.ts` and uses `forattini-dev/cli-args-parser`, matching
the existing `insights` CLI style.

## README Shape

The README is a complete showcase, not just setup instructions.

It should open with:

1. The Grimm tales as shared cultural imagination.
2. The difficulty of turning motifs, roles, violence, transformations, and
   alternate versions into structured data.
3. The gold layer as a conscious canonical collection of 206 tales.
4. RedDB as the database that lets one project query this material through
   multiple models.

Every major section should answer a real question. The first cut uses seven
hero questions:

1. Which predators play the same narrative role across species?
2. Which tales share the same narrative machinery?
3. Does raw word frequency validate a curated theme?
4. What is structurally central in the corpus?
5. How does one tale unfold as narrative functions?
6. Which books/source versions feed this canonical tale?
7. What did the ingest write, and how expensive was it?

Each question section should include:

- a human answer;
- the `./grimm ask <id>` command;
- a short real output snapshot;
- the RedDB model(s) used.

## Docs Shape

Docsify should support two voices through sidebar hierarchy:

- **Editorial/exploratory**: why fairy tales as data, visual atlas, reader,
  source versions, branches.
- **Analytical/technical**: RedDB feature pages, query outputs, pipeline,
  schema, export details.

The first useful docs release should include:

- Overview Atlas with corpus KPIs and top distributions.
- Ask the Corpus using the same seven README questions.
- Tale Reader with gold canonical text first.
- Source reader for original silver/book texts.
- Compare mode later: gold vs source first, source vs source as advanced.
- RedDB Showcase pages for graph, tables, KV, timeseries, and statistics.

## Data Export

`docs/data/*.json` is generated, not versioned.

Sources:

- RedDB embedded for real showcase outputs: collections, graph stats,
  centrality, timeseries metrics, word tables, and query-backed answers.
- Gold/silver YAML for editorial content: tale text, provenance, sources,
  branch metadata, and readable facets.

Commands:

```bash
./grimm rebuild
./grimm export docs
./grimm docs serve
```

GitHub Actions should rebuild embedded data in the known-good order:

1. `./grimm setup`
2. `./grimm rebuild`
3. `./grimm export docs`
4. upload `docs/` to Pages

The rebuild order is important for now: word tables first, graph second.

