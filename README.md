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
- Natural-language queries via `ASK`.

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
- **`output/`** — generated files (gitignored). The SDK writes `embedded.rdb`
  here; `server.rdb` lives here because `docker-compose.yml` bind-mounts
  `./output → /data` into the container.

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

### Coverage

`input/tales.json` is the authoritative manifest. Today: **5 / 62 tales modelled**.

| status     | tales |
|------------|-------|
| modelled   | `ashputtel` (Cinderella), `snowdrop` (Snow White), `hansel-and-gretel`, `little-red-cap`, `the-wolf-and-the-seven-little-kids` |
| pending    | the other 57 entries in `tales.json` |

To add a new tale: drop `input/tales/<slug>.json` following the format
in `SCHEMA.md`, then flip the matching entry in `tales.json` to
`"modelled": true` and point `data_file` at it. No code changes needed.

## Feedback on RedDB 1.0.7 / 1.0.8 (collected while building this)

What we found while writing the examples — non-exhaustive but everything
here was observed empirically.

### `@reddb-io/sdk@1.0.8` (embedded, stdio JSON-RPC)

- ✅ **Connection works** on `memory://` and `file:///abs/path`.
- ✅ **Aggregate SQL works** — `SELECT … COUNT(*) … GROUP BY` returns
  proper rows with column keys.
- ✅ **All `GRAPH <algorithm>` clauses work** — `CENTRALITY`,
  `COMMUNITY`, `COMPONENTS`, `CYCLES`, `CLUSTERING`, `PROPERTIES`,
  `NEIGHBORHOOD '<id>' DIRECTION incoming|outgoing|both`,
  `SHORTEST_PATH '<id>' TO '<id>'`.
- ❌ **`SELECT col FROM coll`** (row projection, no aggregate) returns
  empty rows even when data is there.
- ❌ **`MATCH (n) WHERE n.label = '…' RETURN n.foo`** returns rows but
  every row is `{}`. WHERE also doesn't filter — same number of rows
  regardless. MATCH is documentation-only in 1.0.8.
- ❌ **`db.insert()` returns `{affected}` only** — no `id`. Combined
  with the SELECT issue above, you cannot read back the entity id of
  a freshly inserted node. We work around with a sequential-id offset
  of **+101** (RedDB reserves the first 101 ids per collection for
  internal metadata).
- ❌ **`INSERT … RETURNING *`** rejects graph inserts: *"RETURNING is
  not yet supported for this INSERT path"*.
- ❌ **`GRAPH TRAVERSE FROM '<label>' …`** parse-errors. The label
  exists (we can SELECT it, query it via NEIGHBORHOOD by id) but
  TRAVERSE's label index doesn't see it. Workaround: use id.
- ⚠️ **Multi-row `INSERT … VALUES (…), (…)`** for graph nodes is ~3×
  faster than single-row over stdio. Chunks of 100 nodes / 50 edges
  are sweet spots.

### `@reddb-io/client@1.0.8` (remote — http / red / grpc)

All three transports have observable bugs against a stock `red 1.0.8`
server:

- ❌ **`http://`** — `connect()` rejects with `HTTP_503` because the
  server's `/health` endpoint reports `state: "degraded"` (a normal
  post-boot state — `SELECT 1` round-trips fine) and the client
  treats any non-2xx as fatal. The readiness check is wrong; should
  probably be a `SELECT 1` round-trip.
- ❌ **`red://`** — connects and `INSERT` calls succeed, but `SELECT`
  responses arrive without `rows` / `columns` populated. Only `{ok,
  affected, statement}` comes back. Deserialization of result records
  over the wire protocol is incomplete.
- ❌ **`grpc://`** — `RedDBError: length=68288512 / code:
  FRAME_INVALID_LENGTH` thrown from `redwire.js:414`. Looks like the
  gRPC adapter is routing responses through the redwire frame parser
  instead of decoding them as gRPC payloads.

The server example works around the HTTP issue with a thin raw-`fetch`
shim that mirrors `db.query()`. Wire and gRPC currently fail with the
official client. The shape of the example is forward-compatible — when
the client is fixed, the transport router in `src/server/src/index.ts`
collapses to one line.

### Image distribution

The container image `ghcr.io/reddb-io/reddb:latest` is **private** on
GHCR. Without `docker login ghcr.io` the `docker-compose.yml` flow
errors with `unauthorized`. The server example documents a bare-metal
fallback (running the `red` binary that the SDK's `postinstall` already
downloaded) so the example is runnable without GHCR access.

## Roadmap

1. [ ] Strip Gutenberg header/license from `books.txt`.
2. [ ] Segment the corpus by tale.
3. [ ] Extract entities (NER) — characters, locations, objects.
4. [ ] Enrich `grimm-graph.json` with archetypes, themes, symbolic numbers.
5. [ ] Load nodes and edges into RedDB via `INSERT ... NODE / EDGE`.
6. [ ] Write traversal and community-detection queries.
7. [ ] Try `ASK` natural-language queries over the graph.

## License

- Repo code: MIT.
- Corpus: public domain (see Project Gutenberg license).
