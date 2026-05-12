// Talks to the RedDB server via the official thin remote driver
// (`@reddb-io/client`). Same `db.query()` API as the embedded SDK — the only
// difference is the URI scheme:
//
//   http://host:port      HTTP JSON                  (default port 8080)
//   https://host:port     HTTPS JSON
//   red://host:port       RedWire (TCP)              (default port 5050)
//   reds://host:port      RedWire over TLS
//   grpc://host:port      gRPC                       (default port 5055)
//   grpcs://host:port     gRPC over TLS
//
// Same script, switch transport via env var:
//   REDDB_URL=http://127.0.0.1:8080  pnpm start   (or `pnpm start:http`)
//   REDDB_URL=red://127.0.0.1:5050   pnpm start   (or `pnpm start:wire`)
//   REDDB_URL=grpc://127.0.0.1:5055  pnpm start   (or `pnpm start:grpc`)

import { connect as clientConnect, RedDBError, type RedDB } from '@reddb-io/client'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph, type GrimmGraph } from '../../shared/load-graph.ts'

// ---------------------------------------------------------------------------
// Transport router
//
// @reddb-io/client@1.0.8 has known bugs across the three remote transports
// (filed in the project root README's feedback section):
//
//   http://   connect() rejects with HTTP_503 because /health reports
//             state:"degraded" even when SELECT 1 round-trips fine.
//   red://    queries succeed but the response envelope arrives without
//             rows/columns populated — deserialization is incomplete.
//   grpc://   client tries to parse gRPC responses as redwire frames →
//             FRAME_INVALID_LENGTH.
//
// We work around HTTP with a thin raw-fetch shim that mirrors the
// `db.query()` signature. When the client is fixed for wire/grpc this
// router just becomes `clientConnect(uri)` for all schemes.
// ---------------------------------------------------------------------------

interface HttpRawDb {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>>; columns: string[]; affected: number; statement: string }>
  close(): Promise<void>
}

function httpRawConnect(baseUrl: string): HttpRawDb {
  return {
    async query(sql: string) {
      const res = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const raw = (await res.json()) as {
        ok?: boolean
        error?: string
        affected_rows?: number
        statement?: string
        result?: { columns?: string[]; records?: Array<{ values?: Record<string, unknown> }> }
      }
      if (raw.ok === false) throw new Error(raw.error ?? 'query failed')
      return {
        rows: (raw.result?.records ?? []).map((r) => r.values ?? {}),
        columns: raw.result?.columns ?? [],
        affected: raw.affected_rows ?? 0,
        statement: raw.statement ?? '',
      }
    },
    async close() {
      // fetch is stateless; nothing to close.
    },
  }
}

async function connect(uri: string): Promise<RedDB | HttpRawDb> {
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    // HTTP via raw fetch — workaround for @reddb-io/client's 503 readiness check.
    return httpRawConnect(uri)
  }
  // Wire and gRPC use the official client (currently buggy but kept for forward
  // compatibility — swap this back to clientConnect(uri) once the bugs are fixed).
  return clientConnect(uri)
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..', '..')

const URI = process.env.REDDB_URL ?? 'http://127.0.0.1:8080'
const dataDir = process.env.REDDB_DATA_DIR ?? resolve(repoRoot, 'input')

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function header(label: string): void {
  console.log(`\n=== ${label} ===`)
}

async function safe<T = Record<string, unknown>>(
  db: AnyDb,
  sql: string,
): Promise<T[] | null> {
  try {
    const r = await db.query(sql)
    return (r.rows ?? []) as T[]
  } catch (err) {
    const msg = err instanceof RedDBError ? `[${err.code}] ${err.message}` : String(err)
    console.warn(`  query failed: ${msg}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Ingestion (same shape as the embedded example — see comments there)
// ---------------------------------------------------------------------------

type EntityId = string | number

/** RedDB reserves the first 101 ids per collection for internal metadata. */
const ID_OFFSET = 101
const NODE_CHUNK = 100
const EDGE_CHUNK = 50

type AnyDb = RedDB | HttpRawDb

async function ingestNodes(db: AnyDb, graph: GrimmGraph): Promise<Map<string, EntityId>> {
  const C = graph.collection
  console.log(`Inserting ${graph.nodes.length} nodes into '${C}' in chunks of ${NODE_CHUNK}...`)
  const start = Date.now()

  const labelToId = new Map<string, EntityId>()

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

  // Calibrate
  const firstLabel = graph.nodes[0]?.label
  const firstId = labelToId.get(firstLabel)
  if (firstLabel && firstId !== undefined) {
    try {
      const probe = await db.query(`GRAPH NEIGHBORHOOD '${firstId}'`)
      const me = (probe.rows ?? []).find((r) => Number(r['depth']) === 0)
      if (me?.['label'] === firstLabel) {
        console.log(`  calibration ok — '${firstLabel}' is at id ${firstId}`)
      } else {
        console.warn(
          `  ⚠ calibration mismatch: id ${firstId} resolves to '${me?.['label']}'`,
        )
      }
    } catch (err) {
      console.warn(`  ⚠ calibration probe failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  return labelToId
}

async function ingestEdges(
  db: AnyDb,
  graph: GrimmGraph,
  labelToId: Map<string, EntityId>,
): Promise<void> {
  const C = graph.collection
  console.log(`Inserting ${graph.edges.length} edges into '${C}' in chunks of ${EDGE_CHUNK}...`)
  const start = Date.now()

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

async function existingCount(db: AnyDb, collection: string): Promise<number> {
  try {
    const r = await db.query(`SELECT COUNT(*) FROM ${collection}`)
    const row = r.rows?.[0]
    if (!row) return 0
    const c = Object.values(row)[0]
    if (typeof c === 'number') return c
    if (typeof c === 'string') return Number.parseInt(c, 10) || 0
    return 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Demos
// ---------------------------------------------------------------------------

async function runDemos(
  db: AnyDb,
  C: string,
  labelToId: Map<string, EntityId>,
): Promise<void> {
  header('Entity-type distribution')
  const dist = await safe(
    db,
    `SELECT node_type, COUNT(*) FROM ${C} WHERE node_type IS NOT NULL GROUP BY node_type`,
  )
  if (dist) console.table(dist)

  header('Top edge labels by frequency')
  const edgeLabels = await safe(
    db,
    `SELECT label, COUNT(*) FROM ${C} WHERE node_type IS NULL GROUP BY label`,
  )
  if (edgeLabels) {
    const sorted = edgeLabels
      .slice()
      .sort((a, b) => Number(b['COUNT(*)']) - Number(a['COUNT(*)']))
      .slice(0, 15)
    console.table(sorted)
  }

  header('Top 10 most-central nodes')
  const central = await safe(db, `GRAPH CENTRALITY`)
  if (central) console.table(central.slice(0, 10))

  header('Graph properties')
  const props = await safe(db, `GRAPH PROPERTIES`)
  if (props) console.table(props)

  const pathPairs: Array<[string, string]> = [
    ['evil_queen', 'snow_white'],
    ['lrc_wolf', 'wsk_wolf'],
    ['cinderella', 'snow_white'],
    ['hansel', 'gretel'],
    ['gingerbread_witch', 'evil_queen'],
  ]
  header('Shortest paths between iconic pairs')
  for (const [from, to] of pathPairs) {
    const fromId = labelToId.get(from)
    const toId = labelToId.get(to)
    if (fromId === undefined || toId === undefined) {
      console.log(`  ${from} → ${to}: ✗ unresolved label`)
      continue
    }
    const r = await safe(db, `GRAPH SHORTEST_PATH '${fromId}' TO '${toId}'`)
    const row = r?.[0]
    if (row) {
      const hops = row['hop_count'] ?? row['nodes_visited']
      console.log(`  ${from.padEnd(18)} → ${to.padEnd(18)} ${hops ?? '?'} hops`)
    } else {
      console.log(`  ${from} → ${to}: ✗ no path`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = URI.split('://')[0]
  console.log(`Connecting via ${transport.toUpperCase()} — ${URI}`)
  const db = await connect(URI)

  try {
    // Basic readiness check — round-trip a trivial query.
    await db.query('SELECT 1')
    console.log('RedDB is up.')

    const graph = loadGraph(dataDir)
    console.log(`Loaded ${graph.nodes.length} nodes / ${graph.edges.length} edges from ${dataDir}`)

    let labelToId: Map<string, EntityId>
    const existing = await existingCount(db, graph.collection)
    if (existing > 0) {
      console.log(
        `\nCollection '${graph.collection}' already has ${existing} entities — skipping ingest.\n` +
          `Wipe ./output/server.rdb on the host to re-ingest.`,
      )
      labelToId = new Map(graph.nodes.map((n, i) => [n.label, i + 1 + ID_OFFSET]))
    } else {
      console.log()
      labelToId = await ingestNodes(db, graph)
      await ingestEdges(db, graph, labelToId)
    }

    await runDemos(db, graph.collection, labelToId)
  } finally {
    await db.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
