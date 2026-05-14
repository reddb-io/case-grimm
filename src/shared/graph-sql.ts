import type { GraphPropertyValue, GraphProperties, GrimmEdge, GrimmNode } from './load-graph.ts'

export type EntityId = string | number

type SqlValue = GraphPropertyValue
type Row = Record<string, SqlValue>

export interface InsertBatch {
  columns: string[]
  rows: Row[]
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function sqlValue(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return sqlString(value)
}

function cleanProperties(properties?: GraphProperties): GraphProperties {
  const out: GraphProperties = {}
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) continue
    out[key] = value
  }
  return out
}

function batchRows(rows: Row[], baseColumns: string[]): InsertBatch[] {
  const groups = new Map<string, InsertBatch>()
  for (const row of rows) {
    const extraColumns = Object.keys(row)
      .filter((column) => !baseColumns.includes(column))
      .sort()
    const columns = [...baseColumns, ...extraColumns]
    const signature = columns.join('\0')
    let group = groups.get(signature)
    if (!group) {
      group = { columns, rows: [] }
      groups.set(signature, group)
    }
    group.rows.push(row)
  }
  return [...groups.values()]
}

export function nodeInsertBatches(nodes: GrimmNode[]): InsertBatch[] {
  return batchRows(
    nodes.map((node) => ({
      label: node.label,
      node_type: node.node_type,
      name: node.name,
      ...cleanProperties(node.properties),
    })),
    ['label', 'node_type', 'name'],
  )
}

export function edgeInsertBatches(
  edges: GrimmEdge[],
  labelToId: Map<string, EntityId>,
): { batches: InsertBatch[]; skipped: number; unresolved: Set<string> } {
  const unresolved = new Set<string>()
  const rows: Row[] = []

  for (const edge of edges) {
    const from = labelToId.get(edge.from)
    const to = labelToId.get(edge.to)
    if (from === undefined || to === undefined) {
      if (from === undefined) unresolved.add(edge.from)
      if (to === undefined) unresolved.add(edge.to)
      continue
    }
    rows.push({
      label: edge.label,
      from,
      to,
      ...cleanProperties(edge.properties),
    })
  }

  return {
    batches: batchRows(rows, ['label', 'from', 'to']),
    skipped: edges.length - rows.length,
    unresolved,
  }
}

export function insertSql(
  collection: string,
  entityType: 'NODE' | 'EDGE',
  columns: string[],
  rows: Row[],
): string {
  const tuples = rows
    .map((row) => `(${columns.map((column) => sqlValue(row[column] ?? null)).join(', ')})`)
    .join(', ')
  return `INSERT INTO ${collection} ${entityType} (${columns.join(', ')}) VALUES ${tuples}`
}
