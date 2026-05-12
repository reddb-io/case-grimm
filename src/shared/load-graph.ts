import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

export interface GrimmNode {
  label: string
  node_type: string
  name: string
}
export interface GrimmEdge {
  from: string
  to: string
  label: string
}
export interface GrimmGraph {
  collection: string
  nodes: GrimmNode[]
  edges: GrimmEdge[]
}

function walkJson(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) walkJson(p, acc)
    else if (entry.endsWith('.json')) acc.push(p)
  }
  return acc
}

/**
 * Reads every *.json file under `dataDir` recursively. Only files that
 * declare a `collection` field are treated as graph data — manifests like
 * `tales.json` (no `collection`) are skipped.
 * Nodes are deduped by `label` (first occurrence wins).
 * All graph files must declare the same `collection`.
 */
export function loadGraph(dataDir: string): GrimmGraph {
  const files = walkJson(resolve(dataDir)).sort()

  const seenLabels = new Set<string>()
  const nodes: GrimmNode[] = []
  const edges: GrimmEdge[] = []
  let collection: string | undefined

  for (const path of files) {
    const part = JSON.parse(readFileSync(path, 'utf8')) as Partial<GrimmGraph>

    if (!part.collection || !Array.isArray(part.nodes) || !Array.isArray(part.edges)) {
      continue
    }

    if (collection === undefined) {
      collection = part.collection
    } else if (part.collection !== collection) {
      throw new Error(
        `Collection mismatch in ${path}: got '${part.collection}', expected '${collection}'`,
      )
    }

    for (const n of part.nodes) {
      if (seenLabels.has(n.label)) continue
      seenLabels.add(n.label)
      nodes.push(n)
    }
    edges.push(...part.edges)
  }

  if (!collection) throw new Error(`No graph JSON files found under ${dataDir}`)
  return { collection, nodes, edges }
}
