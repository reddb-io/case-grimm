// insights.ts — folklore-graph analytics over the curated JSON.
//
// One file, many subcommands. All run in pure TS over the loaded graph
// (no RedDB connection needed) so they are deterministic and fast.
//
//   pnpm insights cooc archetype|theme|theme-archetype|number-theme
//   pnpm insights prey
//   pnpm insights triangles
//   pnpm insights reach <slug> [depth]
//   pnpm insights bridges
//   pnpm insights pagerank
//   pnpm insights weirdest [n]
//   pnpm insights subgraph <KINSHIP|PREDATION|HELPING|OWNERSHIP>
//   pnpm insights find theme:X archetype:Y loc:Z sp:W num:N
//   pnpm insights recommend <tale_slug>
//   pnpm insights path <a> <b>
//   pnpm insights explain <character_slug>
//   pnpm insights trope <ontology_slug>
//   pnpm insights match <fp1+fp2+...>
//   pnpm insights pattern "<EDGE>"
//   pnpm insights timeline
//   pnpm insights roleswap
//   pnpm insights lineage <magic_object_slug>

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createCLI, type CommandParseResult } from 'cli-args-parser'
import { connect } from '@reddb-io/sdk'
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { loadGraph } from '../../shared/load-graph.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..', '..')
const graph = loadGraph(resolve(repoRoot, 'input'))

const nodeByLabel = new Map(graph.nodes.map((n) => [n.label, n]))
const nameOf = (lbl: string) => nodeByLabel.get(lbl)?.name ?? lbl
const typeOf = (lbl: string) => nodeByLabel.get(lbl)?.node_type ?? '?'

// Adjacency by label (string-keyed, no id juggling).
type AdjEdge = { to: string; label: string }
const out = new Map<string, AdjEdge[]>()
const inn = new Map<string, AdjEdge[]>()
for (const e of graph.edges) {
  if (!out.has(e.from)) out.set(e.from, [])
  out.get(e.from)!.push({ to: e.to, label: e.label })
  if (!inn.has(e.to)) inn.set(e.to, [])
  inn.get(e.to)!.push({ to: e.from, label: e.label })
}

// Quick indices used by many subcommands.
const charToTale = new Map<string, string>()
const charDirect = new Map<string, Set<string>>() // arc_, sp_
const taleFeatures = new Map<string, Set<string>>() // theme_, loc_, num_, obj_
for (const e of graph.edges) {
  if (e.label === 'APPEARS_IN') charToTale.set(e.from, e.to)
  if (e.label === 'IS_ARCHETYPE' || e.label === 'IS_SPECIES') {
    if (!charDirect.has(e.from)) charDirect.set(e.from, new Set())
    charDirect.get(e.from)!.add(e.to)
  }
  if (
    e.label === 'CONTAINS_THEME' ||
    e.label === 'HAS_LOCATION' ||
    e.label === 'CONTAINS_NUMBER' ||
    e.label === 'HAS_MAGIC_OBJECT'
  ) {
    if (!taleFeatures.has(e.from)) taleFeatures.set(e.from, new Set())
    taleFeatures.get(e.from)!.add(e.to)
  }
}

const isPrefix = (lbl: string, p: string) => lbl.startsWith(p)
const isArchetype = (l: string) => isPrefix(l, 'arc_')
const isTheme = (l: string) => isPrefix(l, 'theme_')
const isLoc = (l: string) => isPrefix(l, 'loc_')
const isSpecies = (l: string) => isPrefix(l, 'sp_')
const isNumber = (l: string) => isPrefix(l, 'num_')
const isObject = (l: string) => isPrefix(l, 'obj_')
const isTale = (l: string) => l.endsWith('_tale')

function fingerprintOf(charLabel: string): Set<string> {
  const fp = new Set<string>()
  for (const x of charDirect.get(charLabel) ?? []) fp.add(x)
  const tale = charToTale.get(charLabel)
  if (tale) for (const x of taleFeatures.get(tale) ?? []) if (!isObject(x)) fp.add(x)
  return fp
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const u = a.size + b.size - inter
  return u === 0 ? 0 : inter / u
}

function intersection(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = []
  for (const x of a) if (b.has(x)) out.push(x)
  return out.sort()
}

// Pretty-print helpers ------------------------------------------------------

function table(rows: Record<string, unknown>[]): void {
  if (!rows.length) {
    console.log('  (no rows)')
    return
  }
  console.table(rows)
}

function header(s: string): void {
  console.log(`\n=== ${s} ===\n`)
}

function asciiEdges(edges: Array<[string, string, string]>, max = 20): void {
  console.log('\nsubgraph:')
  for (const [a, lbl, b] of edges.slice(0, max)) {
    console.log(`  ${a}  --[${lbl}]-->  ${b}`)
  }
  if (edges.length > max) console.log(`  ... +${edges.length - max} more`)
}

// Subcommands ===============================================================

// 1. cooc -------------------------------------------------------------------
const CHAR_LABELS = graph.nodes.filter((n) => n.node_type === 'character').map((n) => n.label)
const TALE_LABELS = graph.nodes.filter((n) => n.node_type === 'tale').map((n) => n.label)

function cooc(kind: string): void {
  if (kind === 'archetype') {
    // characters carrying both archetype X and archetype Y
    const pairs = new Map<string, number>()
    for (const c of CHAR_LABELS) {
      const arcs = [...(charDirect.get(c) ?? [])].filter(isArchetype).sort()
      for (let i = 0; i < arcs.length; i++)
        for (let j = i + 1; j < arcs.length; j++) {
          const k = `${arcs[i]}|${arcs[j]}`
          pairs.set(k, (pairs.get(k) ?? 0) + 1)
        }
    }
    const rows = [...pairs.entries()]
      .map(([k, n]) => {
        const [a, b] = k.split('|')
        return { archetype_a: a, archetype_b: b, characters: n }
      })
      .sort((x, y) => y.characters - x.characters)
      .slice(0, 15)
    header('Top archetype co-occurrences (per character)')
    table(rows)
    return
  }
  if (kind === 'theme') {
    // themes appearing together in the same tale
    const pairs = new Map<string, number>()
    for (const t of TALE_LABELS) {
      const ths = [...(taleFeatures.get(t) ?? [])].filter(isTheme).sort()
      for (let i = 0; i < ths.length; i++)
        for (let j = i + 1; j < ths.length; j++) {
          const k = `${ths[i]}|${ths[j]}`
          pairs.set(k, (pairs.get(k) ?? 0) + 1)
        }
    }
    const rows = [...pairs.entries()]
      .map(([k, n]) => {
        const [a, b] = k.split('|')
        return { theme_a: a, theme_b: b, tales: n }
      })
      .sort((x, y) => y.tales - x.tales)
      .slice(0, 15)
    header('Top theme co-occurrences (per tale)')
    table(rows)
    return
  }
  if (kind === 'theme-archetype') {
    // for each tale, every theme × every archetype carried by a character in that tale
    const pairs = new Map<string, number>()
    for (const t of TALE_LABELS) {
      const themes = [...(taleFeatures.get(t) ?? [])].filter(isTheme)
      const arcs = new Set<string>()
      for (const c of CHAR_LABELS)
        if (charToTale.get(c) === t)
          for (const a of charDirect.get(c) ?? []) if (isArchetype(a)) arcs.add(a)
      for (const th of themes)
        for (const a of arcs) {
          const k = `${th}|${a}`
          pairs.set(k, (pairs.get(k) ?? 0) + 1)
        }
    }
    const rows = [...pairs.entries()]
      .map(([k, n]) => {
        const [t, a] = k.split('|')
        return { theme: t, archetype: a, tales: n }
      })
      .sort((x, y) => y.tales - x.tales)
      .slice(0, 15)
    header('Top theme ↔ archetype affinities')
    table(rows)
    return
  }
  if (kind === 'number-theme') {
    const pairs = new Map<string, number>()
    for (const t of TALE_LABELS) {
      const feats = [...(taleFeatures.get(t) ?? [])]
      const nums = feats.filter(isNumber)
      const themes = feats.filter(isTheme)
      for (const n of nums)
        for (const th of themes) {
          const k = `${n}|${th}`
          pairs.set(k, (pairs.get(k) ?? 0) + 1)
        }
    }
    const rows = [...pairs.entries()]
      .map(([k, n]) => {
        const [num, th] = k.split('|')
        return { number: num, theme: th, tales: n }
      })
      .sort((x, y) => y.tales - x.tales)
      .slice(0, 15)
    header('Top number ↔ theme affinities')
    table(rows)
    return
  }
  console.error(`unknown cooc kind '${kind}'. try: archetype, theme, theme-archetype, number-theme`)
  process.exit(1)
}

// 2. prey -------------------------------------------------------------------
function prey(): void {
  const rows: Record<string, unknown>[] = []
  for (const e of graph.edges) {
    if (e.label !== 'EATS') continue
    const tale = charToTale.get(e.from) ?? charToTale.get(e.to) ?? '?'
    rows.push({
      eater: e.from,
      eater_name: nameOf(e.from),
      eaten: e.to,
      eaten_name: nameOf(e.to),
      tale,
    })
  }
  header(`Predator-prey table (${rows.length} EATS edges)`)
  table(rows)
}

// 3. triangles --------------------------------------------------------------
const NARRATIVE_LABELS = new Set([
  'MARRIES', 'CHILD_OF', 'SIBLING_OF', 'OPPRESSED_BY', 'MISTREATED_BY', 'ENVIES',
  'COMMANDS', 'SPARES', 'SHELTERS', 'HELPS', 'RESCUES', 'KILLS', 'EATS',
  'CAPTURES', 'ABANDONS', 'DECEIVES', 'TRANSFORMS_INTO', 'CURSES', 'PROMISES_TO',
])

function triangles(): void {
  // undirected adjacency over narrative edges between characters
  const adj = new Map<string, Set<string>>()
  for (const e of graph.edges) {
    if (!NARRATIVE_LABELS.has(e.label)) continue
    if (typeOf(e.from) !== 'character' || typeOf(e.to) !== 'character') continue
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    if (!adj.has(e.to)) adj.set(e.to, new Set())
    adj.get(e.from)!.add(e.to)
    adj.get(e.to)!.add(e.from)
  }
  const seen = new Set<string>()
  const tris: string[][] = []
  for (const [a, ns] of adj) {
    for (const b of ns) {
      if (b <= a) continue
      for (const c of adj.get(b) ?? []) {
        if (c <= b) continue
        if (!ns.has(c)) continue
        const k = [a, b, c].sort().join('|')
        if (seen.has(k)) continue
        seen.add(k)
        tris.push([a, b, c])
      }
    }
  }
  header(`Triangles in narrative graph (${tris.length} found)`)
  const rows = tris.slice(0, 20).map(([a, b, c]) => ({
    a: nameOf(a), b: nameOf(b), c: nameOf(c),
    tale: charToTale.get(a) ?? '?',
  }))
  table(rows)
}

// 4. reach ------------------------------------------------------------------
function reach(slug: string, maxDepth = 3): void {
  if (!nodeByLabel.has(slug)) {
    console.error(`unknown slug '${slug}'`)
    process.exit(1)
  }
  // BFS over outgoing AND incoming edges (undirected reach)
  const depths = new Map<string, number>()
  depths.set(slug, 0)
  const queue: string[] = [slug]
  while (queue.length) {
    const cur = queue.shift()!
    const d = depths.get(cur)!
    if (d >= maxDepth) continue
    for (const e of [...(out.get(cur) ?? []), ...(inn.get(cur) ?? [])]) {
      if (depths.has(e.to)) continue
      depths.set(e.to, d + 1)
      queue.push(e.to)
    }
  }
  const byDepth = new Map<number, number>()
  for (const [, d] of depths) byDepth.set(d, (byDepth.get(d) ?? 0) + 1)
  header(`k-hop reach from '${slug}' (${nameOf(slug)})`)
  const rows = [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([d, n]) => ({ depth: d, nodes: n }))
  table(rows)
  console.log(`  total reachable: ${depths.size} / ${graph.nodes.length} nodes`)
}

// 5. bridges ----------------------------------------------------------------
function bridges(): void {
  // Articulation points via Tarjan's DFS over undirected graph.
  const adj = new Map<string, Set<string>>()
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    if (!adj.has(e.to)) adj.set(e.to, new Set())
    adj.get(e.from)!.add(e.to)
    adj.get(e.to)!.add(e.from)
  }
  const disc = new Map<string, number>()
  const low = new Map<string, number>()
  const parent = new Map<string, string | null>()
  const articulation = new Set<string>()
  let time = 0
  function dfs(u: string): void {
    disc.set(u, time)
    low.set(u, time)
    time++
    let children = 0
    for (const v of adj.get(u) ?? []) {
      if (!disc.has(v)) {
        parent.set(v, u)
        children++
        dfs(v)
        low.set(u, Math.min(low.get(u)!, low.get(v)!))
        if (parent.get(u) == null && children > 1) articulation.add(u)
        if (parent.get(u) != null && low.get(v)! >= disc.get(u)!) articulation.add(u)
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!))
      }
    }
  }
  for (const u of adj.keys())
    if (!disc.has(u)) {
      parent.set(u, null)
      dfs(u)
    }
  // Rank articulation points by degree (proxy for impact).
  const rows = [...articulation]
    .map((u) => ({
      label: u,
      name: nameOf(u),
      node_type: typeOf(u),
      degree: adj.get(u)?.size ?? 0,
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 25)
  header(`Articulation points (${articulation.size} total; top 25 by degree)`)
  table(rows)
}

// 6. pagerank ---------------------------------------------------------------
function pagerank(): void {
  // Weighted PageRank. Narrative edges count 3×, classification 1×.
  const W = (lbl: string) => (NARRATIVE_LABELS.has(lbl) ? 3 : 1)
  const nodes = graph.nodes.map((n) => n.label)
  const idx = new Map(nodes.map((l, i) => [l, i]))
  const N = nodes.length
  const outW = new Array<number>(N).fill(0)
  for (const e of graph.edges) {
    const i = idx.get(e.from)
    if (i == null) continue
    outW[i] += W(e.label)
  }
  let pr = new Array<number>(N).fill(1 / N)
  const d = 0.85
  for (let iter = 0; iter < 30; iter++) {
    const next = new Array<number>(N).fill((1 - d) / N)
    for (const e of graph.edges) {
      const i = idx.get(e.from)
      const j = idx.get(e.to)
      if (i == null || j == null) continue
      if (outW[i] === 0) continue
      next[j] += (d * pr[i] * W(e.label)) / outW[i]
    }
    pr = next
  }
  const ranked = nodes
    .map((l, i) => ({ label: l, name: nameOf(l), node_type: typeOf(l), score: pr[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((r) => ({ ...r, score: Number(r.score.toFixed(5)) }))
  header('Top 20 nodes by weighted PageRank')
  table(ranked)
}

// 7. weirdest ---------------------------------------------------------------
function weirdest(n = 10): void {
  // Anti-centroid: characters whose fingerprint is most distant from the
  // average fingerprint frequency vector.
  const freq = new Map<string, number>()
  let total = 0
  const fps = new Map<string, Set<string>>()
  for (const c of CHAR_LABELS) {
    const fp = fingerprintOf(c)
    if (fp.size === 0) continue
    fps.set(c, fp)
    total++
    for (const x of fp) freq.set(x, (freq.get(x) ?? 0) + 1)
  }
  // Score: sum of (1/freq) over the character's fingerprint. Rare features
  // boost weirdness. Normalise by fingerprint size so big-fp characters
  // don't dominate.
  const rows = [...fps]
    .map(([c, fp]) => {
      let s = 0
      for (const x of fp) s += total / (freq.get(x) ?? 1)
      return {
        label: c,
        name: nameOf(c),
        tale: charToTale.get(c) ?? '?',
        fp_size: fp.size,
        weirdness: Number((s / fp.size).toFixed(2)),
      }
    })
    .sort((a, b) => b.weirdness - a.weirdness)
    .slice(0, n)
  header(`Weirdest ${n} characters (rarest fingerprints)`)
  table(rows)
}

// 8. subgraph ---------------------------------------------------------------
const SUBGRAPH_KINDS: Record<string, string[]> = {
  KINSHIP: ['MARRIES', 'CHILD_OF', 'SIBLING_OF'],
  PREDATION: ['EATS', 'KILLS', 'CAPTURES', 'DECEIVES', 'ABANDONS', 'CURSES'],
  HELPING: ['HELPS', 'RESCUES', 'SHELTERS', 'SPARES'],
  OWNERSHIP: ['OWNS', 'ANSWERS_TO', 'PLANTED', 'NESTS_IN'],
}

function subgraphCmd(kind: string): void {
  const labels = SUBGRAPH_KINDS[kind.toUpperCase()]
  if (!labels) {
    console.error(`unknown subgraph kind. try: ${Object.keys(SUBGRAPH_KINDS).join(', ')}`)
    process.exit(1)
  }
  const set = new Set(labels)
  const edges = graph.edges.filter((e) => set.has(e.label))
  // Degree centrality on this subgraph.
  const deg = new Map<string, number>()
  for (const e of edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1)
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1)
  }
  const rows = [...deg.entries()]
    .map(([l, d]) => ({ label: l, name: nameOf(l), node_type: typeOf(l), degree: d }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 15)
  header(`Subgraph '${kind.toUpperCase()}' — ${edges.length} edges, ${deg.size} nodes`)
  console.log(`  edges types: ${labels.join(', ')}`)
  console.log('\ntop 15 by degree:')
  table(rows)
}

// 9. find -------------------------------------------------------------------
function parseFilters(args: string[]): {
  themes: string[]; archetypes: string[]; species: string[]; locs: string[]; nums: string[]
} {
  const f = { themes: [] as string[], archetypes: [] as string[], species: [] as string[], locs: [] as string[], nums: [] as string[] }
  for (const a of args) {
    const [k, v] = a.split(':')
    if (!v) continue
    const slug = v.startsWith('theme_') || v.startsWith('arc_') || v.startsWith('sp_') || v.startsWith('loc_') || v.startsWith('num_') ? v : null
    switch (k) {
      case 'theme': f.themes.push(slug ?? `theme_${v}`); break
      case 'archetype': case 'arc': f.archetypes.push(slug ?? `arc_${v}`); break
      case 'species': case 'sp': f.species.push(slug ?? `sp_${v}`); break
      case 'loc': case 'location': f.locs.push(slug ?? `loc_${v}`); break
      case 'num': case 'number': f.nums.push(slug ?? `num_${v}`); break
    }
  }
  return f
}

function findCmd(args: string[]): void {
  const f = parseFilters(args)
  const required = [...f.themes, ...f.archetypes, ...f.species, ...f.locs, ...f.nums]
  if (!required.length) {
    console.error('usage: pnpm insights find theme:devouring archetype:predator loc:forest')
    process.exit(1)
  }
  const rows: Record<string, unknown>[] = []
  const matched: string[] = []
  for (const c of CHAR_LABELS) {
    const fp = fingerprintOf(c)
    const missing = required.filter((r) => !fp.has(r))
    if (missing.length) continue
    matched.push(c)
    rows.push({ label: c, name: nameOf(c), tale: charToTale.get(c) ?? '?', fp_size: fp.size })
  }
  header(`Matches for filter [${required.join(', ')}] — ${rows.length} characters`)
  table(rows.slice(0, 25))
  // Subgraph: matched chars → required ontology nodes
  const sub: Array<[string, string, string]> = []
  for (const c of matched.slice(0, 15)) {
    for (const r of required) {
      const lbl = r.startsWith('theme_') || r.startsWith('loc_') || r.startsWith('num_')
        ? `tale:${r}` : `direct:${r}`
      sub.push([c, lbl, r])
    }
  }
  asciiEdges(sub, 30)
}

// 10. recommend -------------------------------------------------------------
function taleFP(tale: string): Set<string> {
  const fp = new Set<string>()
  for (const x of taleFeatures.get(tale) ?? []) if (!isObject(x)) fp.add(x)
  // Plus the union of archetypes/species of all characters appearing in the tale.
  for (const c of CHAR_LABELS) {
    if (charToTale.get(c) !== tale) continue
    for (const a of charDirect.get(c) ?? []) fp.add(a)
  }
  return fp
}

function recommendCmd(tale: string): void {
  const slug = tale.endsWith('_tale') ? tale : `${tale}_tale`
  if (!nodeByLabel.has(slug) || typeOf(slug) !== 'tale') {
    console.error(`unknown tale '${slug}'`)
    process.exit(1)
  }
  const a = taleFP(slug)
  const hits = TALE_LABELS
    .filter((t) => t !== slug)
    .map((t) => {
      const b = taleFP(t)
      const score = jaccard(a, b)
      const shared = intersection(a, b)
      return { tale: t, name: nameOf(t), score, shared }
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, 8)
  header(`Tale recommendations for '${slug}' (${nameOf(slug)})`)
  console.log(`  source fingerprint (${a.size}): ${[...a].sort().join(', ')}\n`)
  for (const h of hits) {
    console.log(`  ${(h.score * 100).toFixed(1).padStart(5)}%  ${h.tale.padEnd(38)} — ${h.name}`)
    console.log(`         shared: ${h.shared.join(', ')}`)
  }
}

// 11. path ------------------------------------------------------------------
function pathCmd(a: string, b: string): void {
  if (!nodeByLabel.has(a) || !nodeByLabel.has(b)) {
    console.error('unknown slug')
    process.exit(1)
  }
  // BFS over undirected, all edge types.
  const prev = new Map<string, { from: string; label: string } | null>()
  prev.set(a, null)
  const q: string[] = [a]
  while (q.length) {
    const cur = q.shift()!
    if (cur === b) break
    for (const e of [...(out.get(cur) ?? []), ...(inn.get(cur) ?? [])]) {
      if (prev.has(e.to)) continue
      prev.set(e.to, { from: cur, label: e.label })
      q.push(e.to)
    }
  }
  if (!prev.has(b)) {
    console.log(`no path from ${a} to ${b}`)
    return
  }
  const path: Array<{ from: string; label: string; to: string }> = []
  let cur = b
  while (true) {
    const p = prev.get(cur)
    if (!p) break
    path.unshift({ from: p.from, label: p.label, to: cur })
    cur = p.from
  }
  header(`Shortest path: ${a} → ${b} (${path.length} hops)`)
  const rows = path.map((h, i) => ({
    hop: i + 1,
    from: h.from, label: h.label, to: h.to,
    to_name: nameOf(h.to),
  }))
  table(rows)
  console.log('\nchain:')
  console.log(`  ${a}  ${path.map((h) => `--[${h.label}]-->  ${h.to}`).join('  ')}`)
}

// 12. explain ---------------------------------------------------------------
function explainCmd(slug: string): void {
  if (!nodeByLabel.has(slug)) {
    console.error(`unknown slug '${slug}'`)
    process.exit(1)
  }
  const node = nodeByLabel.get(slug)!
  header(`${slug} (${node.name}) — ${node.node_type}`)
  if (node.node_type === 'character') {
    const tale = charToTale.get(slug)
    const direct = [...(charDirect.get(slug) ?? [])].sort()
    const fp = fingerprintOf(slug)
    console.log(`  tale: ${tale}`)
    console.log(`  direct (${direct.length}): ${direct.join(', ')}`)
    console.log(`  fingerprint (${fp.size}): ${[...fp].sort().join(', ')}`)
    // Outgoing narrative edges
    const narr = (out.get(slug) ?? []).filter((e) => NARRATIVE_LABELS.has(e.label))
    if (narr.length) {
      console.log('\n  outgoing narrative:')
      for (const e of narr) console.log(`    --[${e.label}]-->  ${e.to}  (${nameOf(e.to)})`)
    }
    const inNarr = (inn.get(slug) ?? []).filter((e) => NARRATIVE_LABELS.has(e.label))
    if (inNarr.length) {
      console.log('\n  incoming narrative:')
      for (const e of inNarr) console.log(`    ${e.to}  (${nameOf(e.to)})  --[${e.label}]-->`)
    }
    // Top 5 similar across tales
    const hits = CHAR_LABELS
      .filter((c) => c !== slug && charToTale.get(c) !== tale)
      .map((c) => ({ label: c, score: jaccard(fp, fingerprintOf(c)) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 5)
    console.log('\n  top 5 cross-tale matches:')
    for (const h of hits)
      console.log(`    ${(h.score * 100).toFixed(1).padStart(5)}%  ${h.label}  (${nameOf(h.label)})`)
  } else {
    // ontology / tale: list neighbours
    const ns = out.get(slug) ?? []
    const ins = inn.get(slug) ?? []
    console.log(`  outgoing (${ns.length}):`)
    for (const e of ns.slice(0, 20)) console.log(`    --[${e.label}]-->  ${e.to}`)
    console.log(`\n  incoming (${ins.length}):`)
    for (const e of ins.slice(0, 20)) console.log(`    ${e.to}  --[${e.label}]-->`)
  }
}

// 13. trope -----------------------------------------------------------------
function tropeCmd(slug: string): void {
  if (!nodeByLabel.has(slug)) {
    console.error(`unknown slug '${slug}'`)
    process.exit(1)
  }
  header(`Trope dossier: ${slug} (${nameOf(slug)})`)
  // Carriers
  const carriers: Array<{ label: string; tale: string; via: string }> = []
  for (const e of inn.get(slug) ?? []) {
    carriers.push({ label: e.to, tale: charToTale.get(e.to) ?? '?', via: e.label })
  }
  console.log(`  carriers/tales (${carriers.length}):`)
  table(carriers.slice(0, 25).map((c) => ({
    entity: c.label, name: nameOf(c.label), tale: c.tale, via: c.via,
  })))
  // Co-occurring features (when this slug is on a tale, what else is on the tale?)
  if (isTheme(slug) || isLoc(slug) || isNumber(slug)) {
    const co = new Map<string, number>()
    for (const t of TALE_LABELS) {
      const f = taleFeatures.get(t) ?? new Set()
      if (!f.has(slug)) continue
      for (const x of f) if (x !== slug && !isObject(x)) co.set(x, (co.get(x) ?? 0) + 1)
    }
    const rows = [...co.entries()]
      .map(([l, n]) => ({ co_feature: l, tales: n }))
      .sort((a, b) => b.tales - a.tales)
      .slice(0, 10)
    console.log('\n  top 10 co-occurring features in shared tales:')
    table(rows)
  }
  if (isArchetype(slug) || isSpecies(slug)) {
    // What other archetypes/species do the carriers also carry?
    const co = new Map<string, number>()
    for (const c of carriers) {
      for (const x of charDirect.get(c.label) ?? [])
        if (x !== slug) co.set(x, (co.get(x) ?? 0) + 1)
    }
    const rows = [...co.entries()]
      .map(([l, n]) => ({ co_attribute: l, characters: n }))
      .sort((a, b) => b.characters - a.characters)
      .slice(0, 10)
    console.log('\n  top 10 co-attributes in carriers:')
    table(rows)
  }
}

// 14. match -----------------------------------------------------------------
function matchCmd(spec: string): void {
  const want = new Set(spec.split('+').map((s) => s.trim()).filter(Boolean))
  if (!want.size) {
    console.error('usage: pnpm insights match arc_predator+sp_wolf+theme_forest_danger')
    process.exit(1)
  }
  const rows = CHAR_LABELS
    .map((c) => {
      const fp = fingerprintOf(c)
      const score = jaccard(want, fp)
      const shared = intersection(want, fp)
      return { label: c, name: nameOf(c), tale: charToTale.get(c) ?? '?', score, shared }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
  header(`Synthetic fingerprint match: {${[...want].join(', ')}}`)
  for (const r of rows) {
    console.log(`  ${(r.score * 100).toFixed(1).padStart(5)}%  ${r.label.padEnd(36)} — ${r.name}`)
    console.log(`         tale:   ${r.tale}`)
    console.log(`         shared: ${r.shared.join(', ')}`)
  }
}

// 15. pattern ---------------------------------------------------------------
function patternCmd(edge: string): void {
  const lbl = edge.toUpperCase()
  const matches = graph.edges.filter((e) => e.label === lbl)
  const rows = matches.map((e) => ({
    from: e.from, from_name: nameOf(e.from),
    to: e.to, to_name: nameOf(e.to),
    tale: charToTale.get(e.from) ?? charToTale.get(e.to) ?? '?',
  }))
  header(`Pattern: (X)-[${lbl}]->(Y) — ${rows.length} matches`)
  table(rows.slice(0, 25))
}

// 16. timeline --------------------------------------------------------------
function timelineCmd(): void {
  // Order tales by their slug alphabetically (TALES.json order would be
  // ideal, but slug-order is deterministic and good enough for a first cut).
  // Use TALES.json if present.
  let order: string[] = []
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(repoRoot, 'input/TALES.json'), 'utf8'),
    ) as { tales: Array<{ slug: string; modelled: boolean }> }
    order = manifest.tales
      .filter((t) => t.modelled)
      .map((t) => `${t.slug}_tale`)
      .filter((t) => nodeByLabel.has(t))
  } catch {
    order = [...TALE_LABELS].sort()
  }
  header(`Theme presence by tale order (${order.length} tales)`)
  const rows = order.map((t, i) => {
    const themes = [...(taleFeatures.get(t) ?? [])].filter(isTheme).sort()
    return {
      pos: i + 1,
      tale: t,
      n_themes: themes.length,
      themes: themes.slice(0, 4).map((x) => x.replace('theme_', '')).join(', ')
        + (themes.length > 4 ? `, +${themes.length - 4}` : ''),
    }
  })
  table(rows)
}

// 17. roleswap --------------------------------------------------------------
function roleswapCmd(): void {
  // Archetype-species "expected" pairs we treat as canonical.
  // A "swap" is a character with a predator archetype but non-predator species
  // or vice versa.
  const PREDATOR_ARCS = new Set(['arc_predator', 'arc_disguised_villain', 'arc_evil_witch'])
  const PREDATOR_SPECIES = new Set(['sp_wolf', 'sp_witch', 'sp_bear', 'sp_dragon', 'sp_ogre'])
  const HELPER_ARCS = new Set(['arc_animal_helper', 'arc_wise_helper'])
  const rows: Record<string, unknown>[] = []
  for (const c of CHAR_LABELS) {
    const d = charDirect.get(c) ?? new Set()
    const hasPredArc = [...d].some((x) => PREDATOR_ARCS.has(x))
    const hasPredSp = [...d].some((x) => PREDATOR_SPECIES.has(x))
    const hasHelperArc = [...d].some((x) => HELPER_ARCS.has(x))
    let kind: string | null = null
    if (hasPredArc && !hasPredSp) kind = 'predator-arc, non-predator-species'
    else if (hasPredSp && !hasPredArc && hasHelperArc) kind = 'helper-arc, predator-species'
    if (!kind) continue
    rows.push({
      label: c, name: nameOf(c), tale: charToTale.get(c) ?? '?',
      swap: kind,
      attrs: [...d].filter((x) => isArchetype(x) || isSpecies(x)).sort().join(', '),
    })
  }
  header(`Role-swap detector — ${rows.length} characters`)
  table(rows)
}

// 18. lineage ---------------------------------------------------------------
function lineageCmd(slug: string): void {
  const obj = slug.startsWith('obj_') ? slug : `obj_${slug}`
  if (!nodeByLabel.has(obj)) {
    console.error(`unknown magic_object '${obj}'`)
    process.exit(1)
  }
  header(`Lineage of ${obj} (${nameOf(obj)})`)
  // Tales using it
  const tales = (inn.get(obj) ?? [])
    .filter((e) => e.label === 'HAS_MAGIC_OBJECT')
    .map((e) => e.to)
  // Owners (chars who OWNS this object)
  const owners = (inn.get(obj) ?? [])
    .filter((e) => e.label === 'OWNS')
    .map((e) => e.to)
  console.log(`  tales using it: ${tales.length}`)
  for (const t of tales) console.log(`    - ${t}  (${nameOf(t)})`)
  console.log(`\n  owners: ${owners.length}`)
  for (const o of owners) console.log(`    - ${o}  (${nameOf(o)})`)
  // Other objects in the same tales
  const sibling = new Map<string, number>()
  for (const t of tales) {
    for (const x of taleFeatures.get(t) ?? [])
      if (isObject(x) && x !== obj) sibling.set(x, (sibling.get(x) ?? 0) + 1)
  }
  if (sibling.size) {
    console.log('\n  co-occurring objects in same tales:')
    const rows = [...sibling.entries()]
      .map(([l, n]) => ({ object: l, name: nameOf(l), tales: n }))
      .sort((a, b) => b.tales - a.tales)
    table(rows)
  }
}

// 19. logs ------------------------------------------------------------------
//
// Reads the `ingest_log` TIMESERIES collection written by `pnpm start`.
// Showcases the timeseries model living in the same RedDB file as the graph.
//
// We open the committed snapshot through a tmp copy to avoid locking the
// shipped file. Same trick as query.ts.

function openSnapshot(): { uri: string; cleanup: () => void } {
  if (process.env.REDDB_URI) return { uri: process.env.REDDB_URI, cleanup: () => {} }
  const outDir = resolve(repoRoot, 'output')
  const work = mkdtempSync(resolve(tmpdir(), 'grimms-reddb-'))
  for (const e of readdirSync(outDir)) {
    if (e.startsWith('embedded.rdb')) copyFileSync(resolve(outDir, e), resolve(work, e))
  }
  return {
    uri: `file://${resolve(work, 'embedded.rdb')}`,
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  }
}

async function logsCmd(metric: string | undefined, top: number): Promise<void> {
  const snap = openSnapshot()
  const db = await connect(snap.uri)
  try {
    header('Ingest log — summary by metric')
    const summary = await db.query(
      'SELECT metric, COUNT(*), SUM(value), AVG(value), MIN(value), MAX(value) FROM ingest_log GROUP BY metric',
    )
    if (!summary.rows?.length) {
      console.log('  (no rows — delete output/embedded.rdb and run `pnpm start` to regenerate)')
      return
    }
    table(summary.rows as Record<string, unknown>[])

    if (metric) {
      // tags is stored as a JSON blob; the SDK returns a `<json N bytes>` placeholder
      // for binary columns, so we omit it from the output.
      header(`Last ${top} points for metric '${metric}'`)
      const points = await db.query(
        `SELECT metric, value, timestamp FROM ingest_log WHERE metric = '${metric.replace(/'/g, "''")}' ORDER BY timestamp DESC`,
      )
      const rows = (points.rows ?? []).slice(0, top).map((r) => ({
        timestamp: r.timestamp,
        value: r.value,
      }))
      table(rows)
    } else {
      header('Tip')
      console.log("  pass --metric <name> to drill into individual points, e.g.:")
      console.log("    pnpm insights logs --metric nodes_batch_ms")
    }
  } finally {
    await db.close()
    snap.cleanup()
  }
}

// 20. stats -----------------------------------------------------------------
//
// Descriptive statistics over the graph. All computed from JSON.

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

function describe(values: number[]): Record<string, number> {
  const sorted = [...values].sort((a, b) => a - b)
  const n = values.length
  const sum = values.reduce((s, x) => s + x, 0)
  const mean = n ? sum / n : 0
  const variance = n ? values.reduce((s, x) => s + (x - mean) ** 2, 0) / n : 0
  return {
    n, sum,
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    mean: Number(mean.toFixed(3)),
    stddev: Number(Math.sqrt(variance).toFixed(3)),
  }
}

function statsCmd(): void {
  header('Graph statistics')

  // Degree per node (undirected).
  const deg = new Map<string, number>()
  for (const e of graph.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1)
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1)
  }
  const degValues = [...deg.values()]
  console.log('\ndegree (per node, undirected):')
  table([describe(degValues)])

  // Degree histogram (log-binned).
  const buckets = new Map<string, number>()
  for (const d of degValues) {
    const key = d === 0 ? '0' : d === 1 ? '1' : d <= 3 ? '2-3' : d <= 7 ? '4-7' : d <= 15 ? '8-15' : d <= 31 ? '16-31' : d <= 63 ? '32-63' : '64+'
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const order = ['0', '1', '2-3', '4-7', '8-15', '16-31', '32-63', '64+']
  console.log('\ndegree histogram:')
  table(order.filter((k) => buckets.has(k)).map((k) => ({ bucket: k, nodes: buckets.get(k) })))

  // Archetypes per character.
  const arcPerChar: number[] = []
  for (const c of CHAR_LABELS) {
    arcPerChar.push([...(charDirect.get(c) ?? [])].filter(isArchetype).length)
  }
  console.log('\narchetypes per character:')
  table([describe(arcPerChar)])

  // Themes per tale.
  const themesPerTale: number[] = []
  for (const t of TALE_LABELS) {
    themesPerTale.push([...(taleFeatures.get(t) ?? [])].filter(isTheme).length)
  }
  console.log('\nthemes per tale:')
  table([describe(themesPerTale)])

  // Characters per tale.
  const charsPerTale = new Map<string, number>()
  for (const c of CHAR_LABELS) {
    const t = charToTale.get(c)
    if (!t) continue
    charsPerTale.set(t, (charsPerTale.get(t) ?? 0) + 1)
  }
  console.log('\ncharacters per tale:')
  table([describe([...charsPerTale.values()])])

  // Edge label frequencies.
  const labelFreq = new Map<string, number>()
  for (const e of graph.edges) labelFreq.set(e.label, (labelFreq.get(e.label) ?? 0) + 1)
  const top10 = [...labelFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  const totalEdges = graph.edges.length
  console.log('\ntop edge labels (with share):')
  table(top10.map(([l, n]) => ({ label: l, count: n, share_pct: Number(((n / totalEdges) * 100).toFixed(1)) })))

  // Tale-to-tale theme similarity (mean Jaccard).
  const taleScores: number[] = []
  for (let i = 0; i < TALE_LABELS.length; i++) {
    for (let j = i + 1; j < TALE_LABELS.length; j++) {
      const a = new Set([...(taleFeatures.get(TALE_LABELS[i]) ?? [])].filter(isTheme))
      const b = new Set([...(taleFeatures.get(TALE_LABELS[j]) ?? [])].filter(isTheme))
      taleScores.push(jaccard(a, b))
    }
  }
  console.log('\npair-wise tale theme Jaccard:')
  table([describe(taleScores.map((x) => Number(x.toFixed(4))))])
}

// 21. cypher ----------------------------------------------------------------
//
// Subset Cypher-style pattern matcher over the graph. RedDB v1.0.7's MATCH
// returns empty projections, so we implement a small engine in TS.
//
// Supports:
//   - `(a)-[:LABEL]->(b)` directional edge with label filter
//   - `(a)<-[:LABEL]-(b)` reverse direction
//   - `(a)-[r]->(b)` any label; `r` captured as edge variable
//   - `(a:character)` node-type filter
//   - `(a {label:'cinderella'})` node-property filter (label only)
//   - chained: `(a)-[:L1]->(b)-[:L2]->(c)`
//   - `RETURN a, r, b` (any captured names; missing → all names)
//
// Examples:
//   pnpm insights cypher "(a)-[:DECEIVES]->(b) RETURN a, b"
//   pnpm insights cypher "(a:character)-[:IS_ARCHETYPE]->(b {label:'arc_predator'}) RETURN a"
//   pnpm insights cypher "(a)-[:EATS]->(b)-[:APPEARS_IN]->(t) RETURN a, t"

interface PatternStep {
  fromVar: string
  fromType?: string
  fromLabel?: string
  edgeVar?: string
  edgeLabel?: string
  reverse: boolean
  toVar: string
  toType?: string
  toLabel?: string
}

function parseNodePart(s: string): { v: string; type?: string; label?: string } {
  // s already has surrounding parens stripped.
  // `a`, `a:character`, `a {label:'foo'}`, `:character`, `{label:'foo'}`
  const m = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)?(?::([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s*\{label:\s*'([^']+)'\})?$/)
  if (!m) throw new Error(`bad node pattern: '${s}'`)
  return { v: m[1] || '_', type: m[2], label: m[3] }
}

function parseEdgePart(s: string): { v?: string; label?: string } {
  // `[r]`, `[:LABEL]`, `[r:LABEL]`, `[]`
  const inner = s.slice(1, -1).trim()
  if (!inner) return {}
  const m = inner.match(/^([a-zA-Z_][a-zA-Z0-9_]*)?(?::([A-Z_][A-Z0-9_]*))?$/)
  if (!m) throw new Error(`bad edge pattern: '${s}'`)
  return { v: m[1] || undefined, label: m[2] || undefined }
}

function parsePattern(pattern: string): { steps: PatternStep[]; vars: string[]; returns: string[] } {
  // Split RETURN clause.
  const m = pattern.match(/^(.*?)(?:\s+RETURN\s+(.+))?$/i)
  if (!m) throw new Error(`empty pattern`)
  const left = m[1].trim()
  const returns = m[2]
    ? m[2].split(',').map((s) => s.trim()).filter(Boolean)
    : []
  // Tokenize node/edge pieces.
  // Match (...) , -[..]->, <-[..]-, -[..]-  (only the first two are kept directional)
  const re = /(\([^)]*\))|(<-\[[^\]]*\]-)|(-\[[^\]]*\]->)/g
  const tokens: string[] = []
  let t
  while ((t = re.exec(left)) !== null) tokens.push(t[0])
  if (tokens.length === 0 || tokens.length % 2 === 0) throw new Error('pattern must be (node)-[edge]->(node) ...')
  const steps: PatternStep[] = []
  const vars = new Set<string>()
  for (let i = 0; i + 2 < tokens.length; i += 2) {
    const a = parseNodePart(tokens[i].slice(1, -1).trim())
    const edgeTok = tokens[i + 1]
    const reverse = edgeTok.startsWith('<-')
    const edgeInner = edgeTok.slice(reverse ? 2 : 1, reverse ? -1 : -2)
    const edge = parseEdgePart(edgeInner)
    const b = parseNodePart(tokens[i + 2].slice(1, -1).trim())
    vars.add(a.v); vars.add(b.v)
    if (edge.v) vars.add(edge.v)
    steps.push({
      fromVar: a.v, fromType: a.type, fromLabel: a.label,
      edgeVar: edge.v, edgeLabel: edge.label, reverse,
      toVar: b.v, toType: b.type, toLabel: b.label,
    })
  }
  return { steps, vars: [...vars], returns: returns.length ? returns : [...vars] }
}

function cypherCmd(pattern: string, limit: number): void {
  const plan = parsePattern(pattern)
  const bindings: Record<string, string>[] = [{}]
  for (const step of plan.steps) {
    const next: Record<string, string>[] = []
    for (const b of bindings) {
      // Determine candidates for fromVar (already bound or all nodes).
      const fromCandidates: string[] = b[step.fromVar] !== undefined ? [b[step.fromVar]] : graph.nodes
        .filter((n) => (!step.fromType || n.node_type === step.fromType))
        .filter((n) => (!step.fromLabel || n.label === step.fromLabel))
        .map((n) => n.label)
      for (const f of fromCandidates) {
        // Skip if type/label filters mismatch on already-bound node.
        if (step.fromType && typeOf(f) !== step.fromType) continue
        if (step.fromLabel && f !== step.fromLabel) continue
        const edges = step.reverse ? (inn.get(f) ?? []) : (out.get(f) ?? [])
        for (const e of edges) {
          if (step.edgeLabel && e.label !== step.edgeLabel) continue
          const toLbl = e.to
          if (step.toType && typeOf(toLbl) !== step.toType) continue
          if (step.toLabel && toLbl !== step.toLabel) continue
          if (b[step.toVar] !== undefined && b[step.toVar] !== toLbl) continue
          const nb: Record<string, string> = { ...b, [step.fromVar]: f, [step.toVar]: toLbl }
          if (step.edgeVar) nb[step.edgeVar] = e.label
          next.push(nb)
          if (next.length > limit * 10) break
        }
      }
    }
    if (next.length === 0) {
      header(`Cypher: ${pattern}`)
      console.log('  (no matches)')
      return
    }
    bindings.length = 0
    bindings.push(...next)
  }
  header(`Cypher: ${pattern}  —  ${bindings.length} match(es)${bindings.length > limit ? `, showing ${limit}` : ''}`)
  const rows = bindings.slice(0, limit).map((b) => {
    const row: Record<string, string> = {}
    for (const r of plan.returns) row[r] = b[r] ?? ''
    return row
  })
  table(rows)
}

// 22. words / 23. correlate / 24. richness / 25. ngrams / 26. cosine / 27. about
//
// All these require `pnpm ingest:words` to have run, which populates
// `tale_words`, `tale_bigrams`, `tale_vocab`, plus HLL/SKETCH/FILTER
// showcase collections and KV metadata. They live next to the graph and
// the timeseries ingest log in the same .rdb file.

async function wordsCmd(taleSlug: string | undefined, word: string | undefined, top: number): Promise<void> {
  const snap = openSnapshot()
  const db = await connect(snap.uri)
  try {
    if (word) {
      header(`Tales where '${word}' appears`)
      const r = await db.query(
        `SELECT tale, freq FROM tale_words WHERE word = '${word.replace(/'/g, "''")}' ORDER BY freq DESC`,
      )
      table((r.rows ?? []) as Record<string, unknown>[])
      return
    }
    if (taleSlug) {
      header(`Top ${top} words in '${taleSlug}'`)
      const r = await db.query(
        `SELECT word, freq FROM tale_words WHERE tale = '${taleSlug.replace(/'/g, "''")}' ORDER BY freq DESC LIMIT ${top}`,
      )
      table((r.rows ?? []) as Record<string, unknown>[])
      return
    }
    header(`Top ${top} content words across the corpus`)
    const r = await db.query(
      `SELECT word, SUM(freq), COUNT(*) FROM tale_words GROUP BY word ORDER BY SUM(freq) DESC LIMIT ${top}`,
    )
    table(
      (r.rows ?? []).map((row) => ({
        word: row['word'],
        total_freq: row['SUM(freq)'] ?? row['sum(freq)'],
        in_tales: row['COUNT(*)'] ?? row['count(*)'],
      })),
    )
  } finally {
    await db.close()
    snap.cleanup()
  }
}

async function correlateCmd(themeSlug: string | undefined, top: number): Promise<void> {
  // For each theme, find content words whose tales (with that word) most
  // overlap with the tales carrying the theme. Computed in TS off the
  // already-loaded graph + a quick SQL aggregate per word.
  const snap = openSnapshot()
  const db = await connect(snap.uri)
  try {
    // Pull all word -> tales mapping in one go.
    const r = await db.query('SELECT tale, word, freq FROM tale_words')
    const wordTales = new Map<string, Map<string, number>>()
    for (const row of r.rows ?? []) {
      const w = String(row['word'])
      const t = String(row['tale'])
      const f = Number(row['freq']) || 0
      if (!wordTales.has(w)) wordTales.set(w, new Map())
      wordTales.get(w)!.set(t, f)
    }
    // theme -> set of tale slugs (without `_tale` suffix to match tale_words).
    const themeTales = new Map<string, Set<string>>()
    for (const e of graph.edges) {
      if (e.label !== 'CONTAINS_THEME') continue
      const taleSlug = e.from.replace(/_tale$/, '')
      if (!themeTales.has(e.to)) themeTales.set(e.to, new Set())
      themeTales.get(e.to)!.add(taleSlug)
    }
    const themesToScore = themeSlug ? [themeSlug] : [...themeTales.keys()]
    for (const theme of themesToScore) {
      const tales = themeTales.get(theme)
      if (!tales || !tales.size) {
        console.log(`(no tales with theme '${theme}')`)
        continue
      }
      const scores: Array<{ word: string; lift: number; pos: number; neg: number }> = []
      for (const [w, taleFreq] of wordTales) {
        let pos = 0, neg = 0
        for (const [t] of taleFreq) (tales.has(t) ? pos++ : neg++)
        if (pos < 2) continue
        // lift = P(word | theme) / P(word | ¬theme)
        const pInTheme = pos / tales.size
        const pOut = neg / Math.max(1, 62 - tales.size)
        const lift = pInTheme / Math.max(pOut, 0.01)
        scores.push({ word: w, lift: Number(lift.toFixed(2)), pos, neg })
      }
      scores.sort((a, b) => b.lift - a.lift)
      header(`${theme} — top ${top} content words (lift = P(w|theme)/P(w|¬theme))`)
      table(scores.slice(0, top))
    }
  } finally {
    await db.close()
    snap.cleanup()
  }
}

async function richnessCmd(): Promise<void> {
  const snap = openSnapshot()
  const db = await connect(snap.uri)
  try {
    header('Tales by vocabulary richness (unique_words / total_tokens)')
    const r = await db.query(
      `SELECT tale, total_tokens, unique_words FROM tale_vocab ORDER BY unique_words DESC`,
    )
    const rows = (r.rows ?? []).slice(0, 20).map((row) => {
      const total = Number(row['total_tokens']) || 0
      const uniq = Number(row['unique_words']) || 0
      return {
        tale: row['tale'],
        total_tokens: total,
        unique_words: uniq,
        ttr: total ? Number((uniq / total).toFixed(3)) : 0,  // type-token ratio
      }
    })
    table(rows)

    header('Bottom 10 (least lexical variety)')
    const r2 = await db.query(
      `SELECT tale, total_tokens, unique_words FROM tale_vocab ORDER BY unique_words ASC LIMIT 10`,
    )
    table(
      (r2.rows ?? []).map((row) => {
        const total = Number(row['total_tokens']) || 0
        const uniq = Number(row['unique_words']) || 0
        return {
          tale: row['tale'],
          total_tokens: total,
          unique_words: uniq,
          ttr: total ? Number((uniq / total).toFixed(3)) : 0,
        }
      }),
    )
  } finally {
    await db.close()
    snap.cleanup()
  }
}

async function ngramsCmd(top: number): Promise<void> {
  const snap = openSnapshot()
  const db = await connect(snap.uri)
  try {
    header(`Top ${top} bigrams across the corpus`)
    const r = await db.query(
      `SELECT bigram, SUM(freq), COUNT(*) FROM tale_bigrams GROUP BY bigram ORDER BY SUM(freq) DESC LIMIT ${top}`,
    )
    table(
      (r.rows ?? []).map((row) => ({
        bigram: row['bigram'],
        total_freq: row['SUM(freq)'] ?? row['sum(freq)'],
        in_tales: row['COUNT(*)'] ?? row['count(*)'],
      })),
    )
  } finally {
    await db.close()
    snap.cleanup()
  }
}

function cosineCmd(slug: string, topN: number): void {
  // Cosine similarity over character fingerprints, computed in TS. RedDB
  // v1.0.8 does not yet surface a usable VECTOR collection through the SDK,
  // so this is a TS implementation that complements the Jaccard `sim`.
  if (!nodeByLabel.has(slug) || typeOf(slug) !== 'character') {
    console.error(`'${slug}' is not a character`)
    process.exit(1)
  }
  const targetFp = fingerprintOf(slug)
  const targetTale = charToTale.get(slug)
  // build sparse vectors as Sets weighted by 1; cosine over binary = inter / sqrt(|a|*|b|)
  const hits = CHAR_LABELS
    .filter((c) => c !== slug && charToTale.get(c) !== targetTale)
    .map((c) => {
      const fp = fingerprintOf(c)
      let inter = 0
      for (const x of targetFp) if (fp.has(x)) inter++
      const cosine = inter / Math.sqrt(Math.max(1, targetFp.size) * Math.max(1, fp.size))
      const jac = jaccard(targetFp, fp)
      return {
        label: c, name: nameOf(c),
        tale: charToTale.get(c) ?? '?',
        cosine: Number(cosine.toFixed(3)),
        jaccard: Number(jac.toFixed(3)),
      }
    })
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, topN)
  header(`Cosine similarity to '${slug}' (TS impl; Jaccard shown for comparison)`)
  table(hits)
}

async function aboutCmd(): Promise<void> {
  const snap = openSnapshot()
  const db = await connect(snap.uri)
  try {
    header('Corpus metadata (KV collection — keys with `:` are stored with `_`)')
    const r = await db.query(
      `SELECT key, value FROM kv_default WHERE key LIKE 'corpus%'`,
    )
    table((r.rows ?? []) as Record<string, unknown>[])

    header('Collections in this database (SHOW COLLECTIONS)')
    const c = await db.query('SHOW COLLECTIONS')
    const rows = (c.rows ?? []).map((row) => ({
      name: row['name'],
      model: row['model'],
      entities: row['entities'],
    }))
    table(rows)
  } finally {
    await db.close()
    snap.cleanup()
  }
}

// CLI =======================================================================
//
// Subcommand schema driven by cli-args-parser. Each command declares its
// positional args + options, then dispatches to the analytics function
// above. Validation, --help, --version, completion come for free.

const COOC_KINDS = ['archetype', 'theme', 'theme-archetype', 'number-theme'] as const
const SUBGRAPH_NAMES = Object.keys(SUBGRAPH_KINDS) // KINSHIP, PREDATION, HELPING, OWNERSHIP

function knownNode(value: string): true | string {
  return nodeByLabel.has(value) || `unknown slug '${value}'`
}

function knownCharacter(value: string): true | string {
  if (!nodeByLabel.has(value)) return `unknown slug '${value}'`
  if (nodeByLabel.get(value)!.node_type !== 'character')
    return `'${value}' is a ${nodeByLabel.get(value)!.node_type}, not a character`
  return true
}

const cli = createCLI({
  name: 'insights',
  version: '1.0.0',
  description: 'Folklore-graph analytics over the Grimms\' Fairy Tales corpus.',
  commands: {
    // ----- graph algorithms ---------------------------------------------
    cooc: {
      description: 'Co-occurrence matrix for ontology pairs.',
      positional: [{
        name: 'kind',
        required: true,
        description: `One of: ${COOC_KINDS.join(', ')}`,
        validate: (v) => COOC_KINDS.includes(v as typeof COOC_KINDS[number]) || `must be one of ${COOC_KINDS.join(', ')}`,
      }],
      handler: (r) => cooc(String(r.positional.kind)),
    },
    prey: {
      description: 'Predator-prey table — every EATS edge.',
      handler: () => prey(),
    },
    triangles: {
      description: 'Triangles (3-cycles) in the narrative subgraph.',
      handler: () => triangles(),
    },
    reach: {
      description: 'k-hop blast radius around a node.',
      positional: [{ name: 'slug', required: true, validate: knownNode }],
      options: {
        depth: { type: 'number', short: 'd', default: 3, description: 'Maximum BFS depth.' },
      },
      handler: (r) => reach(String(r.positional.slug), Number(r.options.depth)),
    },
    bridges: {
      description: 'Articulation points (Tarjan over undirected graph).',
      handler: () => bridges(),
    },
    pagerank: {
      description: 'Weighted PageRank (narrative edges 3×, classification 1×).',
      handler: () => pagerank(),
    },
    weirdest: {
      description: 'Characters with the rarest fingerprints (anti-centroid).',
      options: {
        top: { type: 'number', short: 'n', default: 10, description: 'How many to return.' },
      },
      handler: (r) => weirdest(Number(r.options.top)),
    },
    subgraph: {
      description: `Edge-typed subgraph + degree centrality. KIND ∈ {${SUBGRAPH_NAMES.join(', ')}}.`,
      positional: [{
        name: 'kind',
        required: true,
        validate: (v) => SUBGRAPH_NAMES.includes(String(v).toUpperCase()) || `unknown kind. try: ${SUBGRAPH_NAMES.join(', ')}`,
      }],
      handler: (r) => subgraphCmd(String(r.positional.kind)),
    },

    // ----- hybrid search ------------------------------------------------
    find: {
      description: 'Find characters whose fingerprint contains ALL given filters.',
      positional: [{
        name: 'filters',
        variadic: true,
        required: true,
        description: 'theme:X arc:Y loc:Z sp:W num:N (use prefixed slugs or bare names).',
      }],
      handler: (r) => {
        const filters = ([] as string[]).concat(r.positional.filters as string | string[])
        findCmd(filters)
      },
    },
    recommend: {
      description: 'Top-8 tales most similar to the given tale (Jaccard over themes + archetypes).',
      positional: [{
        name: 'tale',
        required: true,
        validate: (v) => {
          const s = String(v).endsWith('_tale') ? String(v) : `${v}_tale`
          return (nodeByLabel.has(s) && typeOf(s) === 'tale') || `unknown tale '${s}'`
        },
      }],
      handler: (r) => recommendCmd(String(r.positional.tale)),
    },
    path: {
      description: 'Shortest path between two nodes (BFS, undirected, any edge label).',
      positional: [
        { name: 'a', required: true, validate: knownNode },
        { name: 'b', required: true, validate: knownNode },
      ],
      handler: (r) => pathCmd(String(r.positional.a), String(r.positional.b)),
    },
    explain: {
      description: 'Full dossier for a node: attributes, neighbours, top-5 similar.',
      positional: [{ name: 'slug', required: true, validate: knownNode }],
      handler: (r) => explainCmd(String(r.positional.slug)),
    },
    trope: {
      description: 'Trope dossier for an ontology node (theme/arc/loc/num): carriers + co-occurring features.',
      positional: [{ name: 'slug', required: true, validate: knownNode }],
      handler: (r) => tropeCmd(String(r.positional.slug)),
    },
    match: {
      description: 'Rank characters whose fingerprint best matches a synthetic spec (slug+slug+slug).',
      positional: [{
        name: 'spec',
        variadic: true,
        required: true,
        description: 'e.g. arc_predator sp_wolf theme_forest_danger',
      }],
      handler: (r) => {
        const parts = ([] as string[]).concat(r.positional.spec as string | string[])
        matchCmd(parts.join('+'))
      },
    },
    pattern: {
      description: 'List every (X)-[EDGE_LABEL]->(Y) match for a given edge label.',
      positional: [{ name: 'label', required: true }],
      aliases: ['edge'],
      handler: (r) => patternCmd(String(r.positional.label)),
    },

    // ----- corpus views -------------------------------------------------
    timeline: {
      description: 'Theme count per tale in manifest order.',
      handler: () => timelineCmd(),
    },
    roleswap: {
      description: 'Characters whose archetype contradicts their species.',
      handler: () => roleswapCmd(),
    },
    lineage: {
      description: 'A magic object across tales: owners + co-occurring objects.',
      positional: [{ name: 'object', required: true }],
      handler: (r) => lineageCmd(String(r.positional.object)),
    },

    // ----- timeseries + stats + cypher ----------------------------------
    logs: {
      description: 'Query the ingest_log timeseries written by `pnpm start`.',
      options: {
        metric: { type: 'string', short: 'm', description: 'Drill into a specific metric.' },
        top: { type: 'number', short: 'n', default: 10, description: 'How many recent points to show.' },
      },
      handler: async (r) => {
        await logsCmd(
          r.options.metric ? String(r.options.metric) : undefined,
          Number(r.options.top),
        )
      },
    },
    stats: {
      description: 'Descriptive statistics: degree distribution, percentiles, share, tale similarity.',
      handler: () => statsCmd(),
    },
    cypher: {
      description: 'Subset Cypher pattern matcher: (a)-[:LABEL]->(b) ... RETURN a, b.',
      positional: [{
        name: 'pattern',
        required: true,
        description: "e.g. \"(a)-[:DECEIVES]->(b) RETURN a, b\"",
      }],
      options: {
        limit: { type: 'number', short: 'l', default: 25, description: 'Max rows to print.' },
      },
      handler: (r) => cypherCmd(String(r.positional.pattern), Number(r.options.limit)),
    },

    // ----- text analytics (requires `pnpm ingest:words`) ---------------
    words: {
      description: 'Top content words from `tale_words`. Filter by tale or by word.',
      options: {
        tale: { type: 'string', short: 't', description: 'Show top words for a specific tale.' },
        word: { type: 'string', short: 'w', description: 'List every tale where this word appears.' },
        top: { type: 'number', short: 'n', default: 15, description: 'How many rows to print.' },
      },
      handler: async (r) => {
        await wordsCmd(
          r.options.tale ? String(r.options.tale) : undefined,
          r.options.word ? String(r.options.word) : undefined,
          Number(r.options.top),
        )
      },
    },
    correlate: {
      description: 'For each theme, content words with highest lift (P(w|theme) / P(w|¬theme)).',
      options: {
        theme: { type: 'string', short: 't', description: 'Restrict to one theme slug (e.g. theme_devouring).' },
        top: { type: 'number', short: 'n', default: 10, description: 'Top words per theme.' },
      },
      handler: async (r) => {
        await correlateCmd(
          r.options.theme ? String(r.options.theme) : undefined,
          Number(r.options.top),
        )
      },
    },
    richness: {
      description: 'Vocabulary size and type-token ratio per tale.',
      handler: async () => { await richnessCmd() },
    },
    ngrams: {
      description: 'Top bigrams across the corpus (from `tale_bigrams`).',
      options: {
        top: { type: 'number', short: 'n', default: 20, description: 'How many rows to print.' },
      },
      handler: async (r) => { await ngramsCmd(Number(r.options.top)) },
    },
    cosine: {
      description: 'Cosine similarity over character fingerprints. Complements `sim` (Jaccard).',
      positional: [{
        name: 'slug',
        required: true,
        validate: knownCharacter,
      }],
      options: {
        top: { type: 'number', short: 'n', default: 8, description: 'How many matches to print.' },
      },
      handler: (r) => cosineCmd(String(r.positional.slug), Number(r.options.top)),
    },
    about: {
      description: 'Corpus metadata from KV + list of all collections in the .rdb file.',
      handler: async () => { await aboutCmd() },
    },
  },
})

const argv = process.argv.slice(2)
if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
  console.log(cli.help())
  process.exit(0)
}

cli.run(argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

// Silence unused-import warning when types aren't referenced elsewhere.
type _Keep = CommandParseResult
