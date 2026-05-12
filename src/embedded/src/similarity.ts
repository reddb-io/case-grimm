// similarity.ts — finds the most-similar characters to a target via Jaccard
// over their ontological fingerprints.
//
// Fingerprint definition (deliberately strict to avoid leaking sibling-
// character features through the tale node):
//
//   character_fp = { archetypes the character carries } ∪
//                  { species the character carries } ∪
//                  { themes attached to the character's tale } ∪
//                  { locations attached to the character's tale } ∪
//                  { symbolic numbers attached to the character's tale }
//
// We build this from the curated JSON in input/ rather than re-traversing
// the graph because the graph's `GRAPH NEIGHBORHOOD … DIRECTION outgoing`
// pulls in features of sibling characters (everyone in the same tale gets
// the same depth-2 hits), which makes a Jaccard score useless for the
// "is X-in-tale-A like Y-in-tale-B?" question.
//
// Usage:
//   pnpm tsx src/similarity.ts <character_label> [topN] [--same-tale]
//   pnpm tsx src/similarity.ts lrc_wolf 8
//   pnpm tsx src/similarity.ts evil_queen 5
//   pnpm tsx src/similarity.ts cinderella 10

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../../shared/load-graph.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..', '..')

const target = process.argv[2] ?? 'lrc_wolf'
const topN = Number.parseInt(process.argv[3] ?? '8', 10)
const includeSameTale = process.argv.includes('--same-tale')

const ONTOLOGY_PREFIXES = ['arc_', 'theme_', 'sp_', 'loc_', 'num_'] as const

function isOntology(label: string): boolean {
  return ONTOLOGY_PREFIXES.some((p) => label.startsWith(p))
}

const graph = loadGraph(resolve(repoRoot, 'input'))

// Index node names + types by label for pretty printing.
const nodeByLabel = new Map(graph.nodes.map((n) => [n.label, n]))

// Build:
//   charToTale[char_label]  = tale_label
//   charArchetypes[char]    = set of arc_/sp_ labels directly attached
//   taleFeatures[tale]      = set of theme_/loc_/num_ labels attached to the tale
const charToTale = new Map<string, string>()
const charDirect = new Map<string, Set<string>>()
const taleFeatures = new Map<string, Set<string>>()

for (const e of graph.edges) {
  if (e.label === 'APPEARS_IN') {
    charToTale.set(e.from, e.to)
  }
  if (e.label === 'IS_ARCHETYPE' || e.label === 'IS_SPECIES') {
    if (!charDirect.has(e.from)) charDirect.set(e.from, new Set())
    charDirect.get(e.from)!.add(e.to)
  }
  if (e.label === 'CONTAINS_THEME' || e.label === 'HAS_LOCATION' || e.label === 'CONTAINS_NUMBER') {
    if (!taleFeatures.has(e.from)) taleFeatures.set(e.from, new Set())
    taleFeatures.get(e.from)!.add(e.to)
  }
}

function fingerprintOf(charLabel: string): Set<string> {
  const fp = new Set<string>()
  for (const x of charDirect.get(charLabel) ?? []) if (isOntology(x)) fp.add(x)
  const tale = charToTale.get(charLabel)
  if (tale) for (const x of taleFeatures.get(tale) ?? []) if (isOntology(x)) fp.add(x)
  return fp
}

function jaccard(a: Set<string>, b: Set<string>): { score: number; intersection: string[] } {
  const inter = new Set<string>()
  for (const x of a) if (b.has(x)) inter.add(x)
  const unionSize = a.size + b.size - inter.size
  return {
    score: unionSize === 0 ? 0 : inter.size / unionSize,
    intersection: Array.from(inter).sort(),
  }
}

function main(): void {
  if (!nodeByLabel.has(target)) {
    console.error(`unknown label: '${target}'`)
    console.error(`tip: use a character slug like 'lrc_wolf', 'evil_queen', 'cinderella', 'gingerbread_witch'`)
    process.exit(1)
  }
  if (nodeByLabel.get(target)!.node_type !== 'character') {
    console.error(`'${target}' is a ${nodeByLabel.get(target)!.node_type}, not a character`)
    process.exit(1)
  }

  const targetFp = fingerprintOf(target)
  const targetTale = charToTale.get(target)
  console.log(`'${target}' (${nodeByLabel.get(target)!.name})`)
  if (targetTale) console.log(`  tale: ${targetTale}`)
  console.log(`  fingerprint (${targetFp.size}): ${[...targetFp].sort().join(', ')}`)

  type Hit = { label: string; name: string; tale: string; score: number; intersection: string[] }
  const hits: Hit[] = []

  for (const c of graph.nodes) {
    if (c.node_type !== 'character') continue
    if (c.label === target) continue
    const tale = charToTale.get(c.label) ?? '?'
    if (!includeSameTale && tale === targetTale) continue
    const fp = fingerprintOf(c.label)
    const { score, intersection } = jaccard(targetFp, fp)
    if (score > 0) hits.push({ label: c.label, name: c.name, tale, score, intersection })
  }

  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  console.log(`\nTop ${topN} ${includeSameTale ? '' : 'cross-tale '}matches:\n`)
  for (const h of hits.slice(0, topN)) {
    const pct = (h.score * 100).toFixed(1).padStart(5)
    console.log(`  ${pct}%  ${h.label.padEnd(38)} — ${h.name}`)
    console.log(`         tale:   ${h.tale}`)
    console.log(`         shared: ${h.intersection.join(', ')}`)
    console.log()
  }
}

main()
