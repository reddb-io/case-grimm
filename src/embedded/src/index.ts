import { connect, RedDBError, type RedDB } from '@reddb-io/sdk'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph, type GrimmGraph } from '../../shared/load-graph.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
// src/embedded/src/index.ts → repo root is 3 levels up
const repoRoot = resolve(__dirname, '..', '..', '..')

const dataDir = process.env.REDDB_DATA_DIR ?? resolve(repoRoot, 'input')
const outDir = resolve(repoRoot, 'output')
mkdirSync(outDir, { recursive: true })

const dbFile = resolve(outDir, 'embedded.rdb')
const uri = process.env.REDDB_URI ?? `file://${dbFile}`

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

/** Quote a value as a SQL string literal, doubling embedded apostrophes. */
function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** Pretty-print a section header. */
function header(label: string): void {
  console.log(`\n=== ${label} ===`)
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

type EntityId = string | number

/**
 * RedDB reserves the first ~100 ids per collection for internal metadata
 * (column descriptors, schema bookkeeping). The first user-inserted NODE
 * gets entity_id `ID_OFFSET + 1`. Empirically confirmed against v1.0.7 on
 * both `memory://` and `file://` DBs.
 *
 * The SDK in v1.0.7 doesn't surface inserted entity ids (insert returns
 * `{affected: 1}` only), and `MATCH … RETURN n.foo` projects empty objects,
 * so we can't read them back post-hoc. We rely on this offset + insertion
 * order instead, then `calibrateOffset` cross-checks it via `GRAPH
 * NEIGHBORHOOD` on the first node.
 */
const ID_OFFSET = 101

/**
 * Inserts every node into the collection and returns a `label → entity_id`
 * map built from **insertion order** (with the engine's reserved offset).
 *
 * This holds only for a **fresh** collection. If the script is run twice
 * against the same file-backed DB without wiping it, ids will not align —
 * `existingCount` short-circuits the whole ingest to prevent that.
 */
const NODE_CHUNK = 100
const EDGE_CHUNK = 50

async function ingestNodes(db: RedDB, graph: GrimmGraph): Promise<Map<string, EntityId>> {
  const C = graph.collection
  console.log(`Inserting ${graph.nodes.length} nodes into '${C}' in chunks of ${NODE_CHUNK}...`)
  const start = Date.now()

  const labelToId = new Map<string, EntityId>()

  // Multi-row VALUES is ~3× faster than one-row-per-call.
  for (let i = 0; i < graph.nodes.length; i += NODE_CHUNK) {
    const batch = graph.nodes.slice(i, i + NODE_CHUNK)
    const tuples = batch
      .map((n) => `(${sqlString(n.label)}, ${sqlString(n.node_type)}, ${sqlString(n.name)})`)
      .join(', ')
    await db.query(`INSERT INTO ${C} NODE (label, node_type, name) VALUES ${tuples}`)
    for (let j = 0; j < batch.length; j++) {
      labelToId.set(batch[j].label, i + j + 1 + ID_OFFSET)
    }
    process.stdout.write(`  ${Math.min(i + NODE_CHUNK, graph.nodes.length)}/${graph.nodes.length}\r`)
  }
  console.log(`  ${graph.nodes.length}/${graph.nodes.length} nodes in ${Date.now() - start}ms`)
  console.log(`  built label → entity_id map for ${labelToId.size} nodes (offset = ${ID_OFFSET})`)

  // Calibrate: ask RedDB for the node at the first user id and confirm its
  // label matches what we inserted first. Fails loudly if the offset changed.
  const firstLabel = graph.nodes[0]?.label
  const firstId = labelToId.get(firstLabel)
  if (firstLabel && firstId !== undefined) {
    try {
      const probe = await db.query(`GRAPH NEIGHBORHOOD '${firstId}'`)
      const me = (probe.rows ?? []).find((r) => Number(r['depth']) === 0)
      const observedLabel = me?.['label']
      if (observedLabel !== firstLabel) {
        console.warn(
          `  ⚠ calibration mismatch: id ${firstId} resolves to '${observedLabel}', expected '${firstLabel}'.\n` +
            `    Edges will likely point at the wrong nodes. Check ID_OFFSET.`,
        )
      } else {
        console.log(`  calibration ok — '${firstLabel}' is at id ${firstId}`)
      }
    } catch (err) {
      console.warn(`  ⚠ calibration probe failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  return labelToId
}

/** Inserts every edge, resolving `from`/`to` labels through the id map. */
async function ingestEdges(
  db: RedDB,
  graph: GrimmGraph,
  labelToId: Map<string, EntityId>,
): Promise<void> {
  const C = graph.collection
  console.log(`Inserting ${graph.edges.length} edges into '${C}' in chunks of ${EDGE_CHUNK}...`)
  const start = Date.now()

  // First pass: filter out edges with unresolved endpoints so we can batch
  // the survivors cleanly.
  const valid: Array<[string, EntityId, EntityId]> = []
  const unresolved = new Set<string>()
  for (const e of graph.edges) {
    const from = labelToId.get(e.from)
    const to = labelToId.get(e.to)
    if (from === undefined || to === undefined) {
      if (from === undefined) unresolved.add(e.from)
      if (to === undefined) unresolved.add(e.to)
      continue
    }
    valid.push([e.label, from, to])
  }
  const skipped = graph.edges.length - valid.length

  for (let i = 0; i < valid.length; i += EDGE_CHUNK) {
    const batch = valid.slice(i, i + EDGE_CHUNK)
    const tuples = batch
      .map(([label, from, to]) => `(${sqlString(label)}, ${from}, ${to})`)
      .join(', ')
    await db.query(`INSERT INTO ${C} EDGE (label, from, to) VALUES ${tuples}`)
    process.stdout.write(`  ${Math.min(i + EDGE_CHUNK, valid.length)}/${valid.length}\r`)
  }
  console.log(`  ${valid.length}/${graph.edges.length} edges in ${Date.now() - start}ms`)
  if (skipped > 0) {
    console.warn(`  ⚠ skipped ${skipped} edges with unresolved endpoints:`)
    for (const u of unresolved) console.warn(`     - ${u}`)
  }
}

/**
 * Returns the number of entities already in the collection. Used to make
 * the script idempotent — if the file-backed DB is reused, we skip ingest.
 */
async function existingCount(db: RedDB, collection: string): Promise<number> {
  try {
    const r = await db.query(`SELECT COUNT(*) FROM ${collection}`)
    const row = r.rows?.[0]
    if (!row) return 0
    const c = Object.values(row)[0]
    if (typeof c === 'number') return c
    if (typeof c === 'string') return Number.parseInt(c, 10) || 0
    return 0
  } catch {
    return 0 // collection doesn't exist yet
  }
}

// ---------------------------------------------------------------------------
// Demo queries
// ---------------------------------------------------------------------------

async function safe(db: RedDB, sql: string): Promise<Array<Record<string, unknown>> | null> {
  try {
    const r = await db.query(sql)
    return r.rows ?? []
  } catch (err) {
    const msg = err instanceof RedDBError ? `[${err.code}] ${err.message}` : String(err)
    console.warn(`  query failed: ${msg}`)
    return null
  }
}

async function runDemos(
  db: RedDB,
  C: string,
  labelToId: Map<string, EntityId>,
): Promise<void> {
  // ---------------------------------------------------------------------
  // Aggregate SQL — these return real rows in RedDB 1.0.7.
  //
  // (Caveats: plain row-projection SELECT — `SELECT name FROM tales WHERE
  // node_type = 'character'` — currently returns empty rows, and MATCH
  // RETURN n.foo also returns empty objects. Aggregates with GROUP BY are
  // the reliable path.)
  // ---------------------------------------------------------------------

  header('Entity-type distribution')
  const dist = await safe(
    db,
    `SELECT node_type, COUNT(*) FROM ${C} WHERE node_type IS NOT NULL GROUP BY node_type`,
  )
  if (dist) console.table(dist)

  header('Top edge labels by frequency')
  const edgeLabels = await safe(
    db,
    // Edges have label but no node_type — filter out node rows by requiring node_type IS NULL.
    `SELECT label, COUNT(*) FROM ${C} WHERE node_type IS NULL GROUP BY label`,
  )
  if (edgeLabels) {
    // Show top 15 sorted by count descending.
    const sorted = edgeLabels
      .slice()
      .sort((a, b) => Number(b['COUNT(*)']) - Number(a['COUNT(*)']))
      .slice(0, 15)
    console.table(sorted)
  }

  header('How devouring is the corpus?')
  for (const label of ['EATS', 'KILLS', 'DECEIVES', 'CURSES', 'CAPTURES', 'RESCUES']) {
    const r = await safe(
      db,
      `SELECT COUNT(*) FROM ${C} WHERE label = ${sqlString(label)}`,
    )
    const n = r?.[0]?.['count(*)'] ?? r?.[0]?.['COUNT(*)'] ?? '?'
    console.log(`  ${label.padEnd(10)} ${n}`)
  }

  // ---------------------------------------------------------------------
  // Graph algorithms — return rich rows with full property projection.
  // ---------------------------------------------------------------------

  header('Top 10 most-central nodes (degree centrality)')
  const central = await safe(db, `GRAPH CENTRALITY`)
  if (central) console.table(central.slice(0, 10))

  header('Top 5 largest communities')
  const communities = await safe(db, `GRAPH COMMUNITY`)
  if (communities) console.table(communities.slice(0, 5))

  header('Top 5 largest connected components')
  const comps = await safe(db, `GRAPH COMPONENTS`)
  if (comps) console.table(comps.slice(0, 5))

  header('Cycles detected (first 5)')
  const cycles = await safe(db, `GRAPH CYCLES`)
  if (cycles) console.table(cycles.slice(0, 5))

  header('Highest local clustering coefficient (top 5)')
  const clustering = await safe(db, `GRAPH CLUSTERING`)
  if (clustering) console.table(clustering.slice(0, 5))

  // ---------------------------------------------------------------------
  // Shortest path between two specific characters, resolved via our id map.
  // ---------------------------------------------------------------------

  const pathPairs: Array<[string, string]> = [
    ['evil_queen', 'snow_white'],   // antagonist → protagonist in Snowdrop
    ['lrc_wolf', 'wsk_wolf'],       // wolf → wolf across two tales
    ['cinderella', 'snow_white'],   // Cinderella → Snow White (cross-tale)
    ['hansel', 'gretel'],           // sibling
    ['gingerbread_witch', 'evil_queen'], // two witches across tales
  ]
  header('Shortest paths between iconic character pairs')
  for (const [from, to] of pathPairs) {
    const fromId = labelToId.get(from)
    const toId = labelToId.get(to)
    if (fromId === undefined || toId === undefined) {
      console.log(`  ${from} → ${to}: ✗ unresolved label`)
      continue
    }
    const r = await safe(
      db,
      `GRAPH SHORTEST_PATH '${fromId}' TO '${toId}'`,
    )
    const row = r?.[0]
    if (row) {
      const hops = row['hop_count'] ?? row['nodes_visited']
      console.log(`  ${from.padEnd(14)} → ${to.padEnd(14)} ${hops ?? '?'} hops`)
    } else {
      console.log(`  ${from} → ${to}: ✗ no path`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const graph = loadGraph(dataDir)
  console.log(`Loaded ${graph.nodes.length} nodes / ${graph.edges.length} edges from ${dataDir}`)
  console.log(`Target: ${uri}`)

  const db = await connect(uri)

  try {
    const existing = await existingCount(db, graph.collection)
    let labelToId: Map<string, EntityId>

    if (existing > 0) {
      console.log(
        `\nCollection '${graph.collection}' already has ${existing} entities — skipping ingest.\n` +
          `Delete ${dbFile} (or set REDDB_URI=memory://) to re-ingest.`,
      )
      // Rebuild the map from the in-memory graph definition. As long as the
      // graph file hasn't changed since the last ingest, insertion order
      // (alphabetical by source file) still gives correct ids.
      labelToId = new Map(graph.nodes.map((n, i) => [n.label, i + 1 + ID_OFFSET]))
    } else {
      console.log()
      labelToId = await ingestNodes(db, graph)
      await ingestEdges(db, graph, labelToId)
    }

    await runDemos(db, graph.collection, labelToId)
  } catch (err) {
    if (err instanceof RedDBError) console.error(`\n[${err.code}] ${err.message}`)
    else throw err
  } finally {
    await db.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
