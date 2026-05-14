import { connect, RedDBError, type RedDB } from '@reddb-io/sdk'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph, type GrimmGraph } from '../../shared/load-graph.ts'
import {
  edgeInsertBatches,
  insertSql,
  nodeInsertBatches,
  type EntityId,
} from '../../shared/graph-sql.ts'

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

/** Inserts every node into the graph collection. */
const NODE_CHUNK = 100
const EDGE_CHUNK = 50

/**
 * Bootstraps the `ingest_log` TIMESERIES collection. RedDB ships native
 * timeseries support; here we use it to record per-batch ingestion metrics
 * so the showcase doubles as a demo of the timeseries model alongside graph.
 *
 * Columns are fixed by the engine: metric, value, tags (JSON string),
 * timestamp (ms since epoch).
 */
async function ensureIngestLog(db: RedDB, name = 'ingest_log'): Promise<string> {
  try {
    await db.query(`CREATE TIMESERIES ${name}`)
  } catch {
    // already exists — fine
  }
  return name
}

async function logPoint(
  db: RedDB,
  collection: string,
  metric: string,
  value: number,
  tags: Record<string, string | number> = {},
): Promise<void> {
  const tagsJson = sqlString(JSON.stringify(tags))
  await db.query(
    `INSERT INTO ${collection} (metric, value, tags, timestamp) VALUES (${sqlString(metric)}, ${value}, ${tagsJson}, ${Date.now()})`,
  )
}

async function ingestNodes(
  db: RedDB,
  graph: GrimmGraph,
  logCollection: string,
): Promise<void> {
  const C = graph.collection
  console.log(`Inserting ${graph.nodes.length} nodes into '${C}' in chunks of ${NODE_CHUNK}...`)
  const start = Date.now()
  let inserted = 0

  for (const group of nodeInsertBatches(graph.nodes)) {
    for (let i = 0; i < group.rows.length; i += NODE_CHUNK) {
      const batchStart = Date.now()
      const rows = group.rows.slice(i, i + NODE_CHUNK)
      await db.query(insertSql(C, 'NODE', group.columns, rows))
      const batchMs = Date.now() - batchStart
      inserted += rows.length
      await logPoint(db, logCollection, 'nodes_batch_ms', batchMs, {
        phase: 'nodes',
        batch_idx: Math.floor(inserted / NODE_CHUNK),
        batch_size: rows.length,
      })
      await logPoint(db, logCollection, 'nodes_inserted', rows.length, { phase: 'nodes' })
      process.stdout.write(`  ${inserted}/${graph.nodes.length}\r`)
    }
  }
  const total = Date.now() - start
  console.log(`  ${graph.nodes.length}/${graph.nodes.length} nodes in ${total}ms`)
  await logPoint(db, logCollection, 'nodes_total_ms', total, { phase: 'nodes' })
}

async function buildLabelToId(db: RedDB, graph: GrimmGraph): Promise<Map<string, EntityId>> {
  const expected = new Set(graph.nodes.map((n) => n.label))
  const labelToId = new Map<string, EntityId>()
  const result = await db.query(`GRAPH CENTRALITY LIMIT ${graph.nodes.length}`)
  for (const row of result.rows ?? []) {
    const label = row['label']
    const id = row['node_id']
    if (typeof label !== 'string' || !expected.has(label)) continue
    if (typeof id === 'string' || typeof id === 'number') labelToId.set(label, id)
  }

  const missing = graph.nodes
    .map((n) => n.label)
    .filter((label) => !labelToId.has(label))
  if (missing.length > 0) {
    throw new Error(
      `Could not resolve ${missing.length} graph node ids from RedDB; first missing labels: ${missing.slice(0, 10).join(', ')}`,
    )
  }

  console.log(`  resolved label → node_id map for ${labelToId.size} nodes from RedDB`)
  return labelToId
}

/** Inserts every edge, resolving `from`/`to` labels through the id map. */
async function ingestEdges(
  db: RedDB,
  graph: GrimmGraph,
  labelToId: Map<string, EntityId>,
  logCollection: string,
): Promise<void> {
  const C = graph.collection
  console.log(`Inserting ${graph.edges.length} edges into '${C}' in chunks of ${EDGE_CHUNK}...`)
  const start = Date.now()

  const { batches, skipped, unresolved } = edgeInsertBatches(graph.edges, labelToId)
  const validCount = graph.edges.length - skipped
  let inserted = 0

  for (const group of batches) {
    for (let i = 0; i < group.rows.length; i += EDGE_CHUNK) {
      const batchStart = Date.now()
      const rows = group.rows.slice(i, i + EDGE_CHUNK)
      await db.query(insertSql(C, 'EDGE', group.columns, rows))
      const batchMs = Date.now() - batchStart
      inserted += rows.length
      await logPoint(db, logCollection, 'edges_batch_ms', batchMs, {
        phase: 'edges',
        batch_idx: Math.floor(inserted / EDGE_CHUNK),
        batch_size: rows.length,
      })
      await logPoint(db, logCollection, 'edges_inserted', rows.length, { phase: 'edges' })
      process.stdout.write(`  ${inserted}/${validCount}\r`)
    }
  }
  const total = Date.now() - start
  console.log(`  ${validCount}/${graph.edges.length} edges in ${total}ms`)
  await logPoint(db, logCollection, 'edges_total_ms', total, { phase: 'edges' })
  if (skipped > 0) await logPoint(db, logCollection, 'edges_skipped', skipped, { phase: 'edges' })
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
  // Aggregates exercise the graph collection through SQL's row-shaped
  // projection path, complementing the graph-native analytics below.
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
    ['snow_white_stepmother_queen', 'snow_white'], // antagonist → protagonist in Snow White
    ['little_red_cap_wolf', 'seven_kids_wolf'],    // wolf → wolf across two tales
    ['cinderella', 'snow_white'],                  // Cinderella → Snow White (cross-tale)
    ['hansel', 'gretel'],           // sibling
    ['hansel_gretel_witch', 'snow_white_stepmother_queen'], // two witches across tales
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

  // ---------------------------------------------------------------------
  // Timeseries demo — read back the ingest log written during this run
  // (or a previous one, since the snapshot keeps it). Showcases the
  // timeseries model living next to the graph in the same database file.
  // ---------------------------------------------------------------------

  header('Ingest log (timeseries collection)')
  const ingestStats = await safe(
    db,
    `SELECT metric, COUNT(*), SUM(value), AVG(value), MIN(value), MAX(value) FROM ingest_log GROUP BY metric`,
  )
  if (ingestStats && ingestStats.length) {
    console.table(ingestStats)
  } else {
    console.log('  (no ingest_log entries — the snapshot was loaded without re-ingesting)')
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
      labelToId = await buildLabelToId(db, graph)
    } else {
      console.log()
      const overallStart = Date.now()
      const logCol = await ensureIngestLog(db)
      await ingestNodes(db, graph, logCol)
      labelToId = await buildLabelToId(db, graph)
      await ingestEdges(db, graph, labelToId, logCol)
      await logPoint(db, logCol, 'ingest_total_ms', Date.now() - overallStart, { phase: 'overall' })
      await logPoint(db, logCol, 'nodes_total', graph.nodes.length, { phase: 'overall' })
      await logPoint(db, logCol, 'edges_total', graph.edges.length, { phase: 'overall' })
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
