import { connect } from '@reddb-io/sdk'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { loadGraph } from '../../shared/load-graph.ts'

type AnyRecord = Record<string, any>

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..', '..')
const inputRoot = resolve(repoRoot, 'input')
const goldRoot = resolve(inputRoot, '3-gold')
const taleDir = resolve(goldRoot, 'tales')
const docsDataDir = resolve(repoRoot, 'docs', 'data')
const dbUri = `file://${resolve(repoRoot, 'output', 'embedded.rdb')}`

const showcaseQuestions = [
  {
    id: 'predators',
    question: 'Which predators play the same narrative role across species?',
    answer: 'Predator is a narrative job, not just a species: wolves, foxes, witches, cats, lions, and human villains can occupy the same structural role.',
    models: ['graph', 'statistics'],
    command: './grimm ask predators',
  },
  {
    id: 'tale-machinery',
    question: 'Which tales share the same narrative machinery?',
    answer: 'Similarity over curated fingerprints surfaces tales that reuse the same structural ingredients even when the prose looks unrelated.',
    models: ['graph', 'statistics'],
    command: './grimm ask tale-machinery',
  },
  {
    id: 'devouring-words',
    question: 'Can raw word tables ground a narrative pattern?',
    answer: 'The word tables show where a concrete motif appears in the canonical corpus without leaving the same embedded RedDB file.',
    models: ['tables'],
    command: './grimm ask devouring-words',
  },
  {
    id: 'central-concepts',
    question: 'What is structurally central in the corpus?',
    answer: 'The graph reveals recurring machinery: traits, narrative functions, appearances, agency, locations, and ordered Propp events.',
    models: ['graph', 'statistics'],
    command: './grimm ask central-concepts',
  },
  {
    id: 'propp-hansel',
    question: 'How does one tale unfold as narrative functions?',
    answer: 'Hansel and Gretel can be read as prose and as an ordered chain of narrative functions with actor, scene, and evidence.',
    models: ['graph'],
    command: './grimm ask propp-hansel',
  },
  {
    id: 'provenance',
    question: 'Which books and source versions feed this canonical tale?',
    answer: 'The gold corpus separates the canonical tale from its book sources while retaining source references for provenance and comparison.',
    models: ['KV', 'gold corpus'],
    command: './grimm ask provenance',
  },
  {
    id: 'ingest',
    question: 'What did the ingest write, and how expensive was it?',
    answer: 'The embedded database records ingest work as time-series rows, so the demo can inspect its own build cost.',
    models: ['timeseries', 'KV'],
    command: './grimm ask ingest',
  },
]

function readYaml(path: string): AnyRecord {
  return yaml.load(readFileSync(path, 'utf8')) as AnyRecord
}

function readText(path: string): string {
  return readFileSync(path, 'utf8').trim()
}

function resolveFrom(baseFile: string, relativePath: string): string {
  return resolve(dirname(baseFile), relativePath)
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function firstParagraphs(text: string, count: number): string {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, count)
    .join('\n\n')
}

function sourceTextPath(bookId: string, slug: string): string {
  return resolve(inputRoot, '2-silver', 'books', bookId, 'tales', `${slug}.txt`)
}

function sourceRows(corpus: AnyRecord, slug: string): AnyRecord[] {
  const bookTales = new Map<string, AnyRecord>(
    (corpus.book_tales ?? []).map((row: AnyRecord) => [row.id, row]),
  )
  const books = new Map<string, AnyRecord>(
    (corpus.books ?? []).map((row: AnyRecord) => [row.book_id, row]),
  )

  return (corpus.canonical_sources ?? [])
    .filter((row: AnyRecord) => row.canonical_slug === slug)
    .map((row: AnyRecord) => {
      const bookTale = bookTales.get(row.book_tale_id)
      const book = books.get(row.book_id)
      const textPath = row.book_tale_slug ? sourceTextPath(row.book_id, row.book_tale_slug) : null
      return {
        ...row,
        title: bookTale?.title ?? row.book_tale_slug,
        khm: bookTale?.khm ?? null,
        atu: bookTale?.atu ?? null,
        language: bookTale?.language ?? null,
        word_count: bookTale?.word_count ?? null,
        book_word_count: book?.word_count ?? null,
        text_file: textPath && existsSync(textPath)
          ? textPath.replace(`${repoRoot}/`, '')
          : null,
      }
    })
}

function branchRows(corpus: AnyRecord, slug: string): AnyRecord[] {
  return (corpus.canonical_branches ?? [])
    .filter((row: AnyRecord) => row.canonical_slug === slug)
}

function relationNames(edges: AnyRecord[], nodesByLabel: Map<string, AnyRecord>, label: string): string[] {
  return edges
    .filter((edge) => edge.label === label)
    .map((edge) => nodesByLabel.get(edge.to)?.name ?? edge.to)
    .filter(Boolean)
}

async function safeRows(db: Awaited<ReturnType<typeof connect>>, sql: string): Promise<AnyRecord[]> {
  try {
    const result = await db.query(sql)
    return (result.rows ?? []) as AnyRecord[]
  } catch {
    return []
  }
}

async function redDbOverview(): Promise<AnyRecord> {
  if (!existsSync(resolve(repoRoot, 'output', 'embedded.rdb'))) return {}

  const db = await connect(dbUri)
  try {
    const collections = await safeRows(db, 'SHOW COLLECTIONS')
    const ingest_metrics = await safeRows(
      db,
      'SELECT metric, COUNT(*), SUM(value), AVG(value), MIN(value), MAX(value) FROM ingest_log GROUP BY metric',
    )
    const centrality = await safeRows(db, 'GRAPH CENTRALITY')
    const taleWords = await safeRows(db, 'SELECT COUNT(*) FROM tale_words')
    const taleBigrams = await safeRows(db, 'SELECT COUNT(*) FROM tale_bigrams')
    const taleVocab = await safeRows(db, 'SELECT COUNT(*) FROM tale_vocab')

    return {
      collections,
      ingest_metrics,
      centrality_top: centrality.slice(0, 25),
      table_counts: {
        tale_words: taleWords[0]?.['COUNT(*)'] ?? taleWords[0]?.['count(*)'] ?? null,
        tale_bigrams: taleBigrams[0]?.['COUNT(*)'] ?? taleBigrams[0]?.['count(*)'] ?? null,
        tale_vocab: taleVocab[0]?.['COUNT(*)'] ?? taleVocab[0]?.['count(*)'] ?? null,
      },
    }
  } finally {
    await db.close()
  }
}

function buildTales(corpus: AnyRecord, graph: ReturnType<typeof loadGraph>): AnyRecord[] {
  const nodesByLabel = new Map(graph.nodes.map((node) => [node.label, node]))

  return readdirSync(taleDir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((file) => {
      const path = resolve(taleDir, file)
      const tale = readYaml(path)
      const textPath = resolveFrom(path, tale.canonical_source)
      const text = existsSync(textPath) ? readText(textPath) : ''
      const taleLabel = `${String(tale.slug).replace(/-/g, '_')}_tale`
      const localNodes = graph.nodes.filter((node) => node.properties?.tale_slug === tale.slug || node.label === taleLabel)
      const localEdges = graph.edges.filter((edge) => edge.properties?.tale_slug === tale.slug || edge.from === taleLabel)

      return {
        slug: tale.slug,
        title: tale.title,
        khm: tale.khm ?? null,
        atu: tale.atu ?? null,
        atu_name: tale.atu_name ?? null,
        canonical_source: tale.canonical_source,
        stats: {
          words: words(text),
          characters: Object.keys(tale.entities?.characters ?? {}).length,
          magic_objects: Object.keys(tale.entities?.magic_objects ?? {}).length,
          locations: Object.keys(tale.entities?.locations ?? {}).length,
          propp_events: Array.isArray(tale.propp) ? tale.propp.length : 0,
          graph_nodes: localNodes.length,
          graph_edges: localEdges.length,
        },
        facets: {
          characters: Object.values(tale.entities?.characters ?? {}).map((row) => (row as AnyRecord).name),
          themes: relationNames(localEdges, nodesByLabel, 'CONTAINS_THEME'),
          world_laws: relationNames(localEdges, nodesByLabel, 'HAS_WORLD_LAW'),
          moral_regimes: relationNames(localEdges, nodesByLabel, 'HAS_MORAL_REGIME'),
          locations: Object.values(tale.entities?.locations ?? {}).map((row) => (row as AnyRecord).name),
          numbers: relationNames(localEdges, nodesByLabel, 'CONTAINS_NUMBER'),
        },
        sources: sourceRows(corpus, tale.slug),
        branches: branchRows(corpus, tale.slug),
        text,
      }
    })
}

async function exportDocs(): Promise<void> {
  const corpus = readYaml(resolve(goldRoot, 'corpus.yaml'))
  const graph = loadGraph(inputRoot)
  const tales = buildTales(corpus, graph)
  const redDb = await redDbOverview()

  mkdirSync(docsDataDir, { recursive: true })
  writeFileSync(resolve(docsDataDir, 'tales.json'), `${JSON.stringify({
    generated_at: new Date().toISOString(),
    source: {
      gold: 'input/3-gold/tales/*.yaml',
      corpus: 'input/3-gold/corpus.yaml',
      embedded: 'output/embedded.rdb',
    },
    totals: {
      tales: tales.length,
      graph_nodes: graph.nodes.length,
      graph_edges: graph.edges.length,
      traits: graph.nodes.filter((node) => node.node_type === 'trait').length,
      propp_events: graph.nodes.filter((node) => node.node_type === 'propp_event').length,
    },
    tales,
  }, null, 2)}\n`)

  writeFileSync(resolve(docsDataDir, 'overview.json'), `${JSON.stringify({
    generated_at: new Date().toISOString(),
    corpus: corpus.counters,
    graph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      node_types: Object.entries(graph.nodes.reduce((acc: Record<string, number>, node) => {
        acc[node.node_type] = (acc[node.node_type] ?? 0) + 1
        return acc
      }, {})).map(([node_type, count]) => ({ node_type, count })),
    },
    reddb: redDb,
  }, null, 2)}\n`)

  writeFileSync(resolve(docsDataDir, 'questions.json'), `${JSON.stringify({
    generated_at: new Date().toISOString(),
    questions: showcaseQuestions,
  }, null, 2)}\n`)

  console.log(`Wrote docs/data for ${tales.length} tales`)
}

function printSources(slug: string): void {
  const corpus = readYaml(resolve(goldRoot, 'corpus.yaml'))
  console.table(sourceRows(corpus, slug))
}

function printTale(slug: string, full: boolean): void {
  const path = resolve(taleDir, `${slug}.yaml`)
  if (!existsSync(path)) {
    console.error(`Unknown tale '${slug}'`)
    process.exit(1)
  }
  const tale = readYaml(path)
  const textPath = resolveFrom(path, tale.canonical_source)
  const text = existsSync(textPath) ? readText(textPath) : ''
  console.log(`# ${tale.title}`)
  console.log([tale.khm ? `KHM ${tale.khm}` : null, tale.atu ? `ATU ${tale.atu}` : null].filter(Boolean).join(' · '))
  console.log('')
  console.log(full ? text : firstParagraphs(text, 4))
  console.log('')
  printSources(slug)
}

const args = process.argv.slice(2)
const printSourcesIndex = args.indexOf('--print-sources')
const printTaleIndex = args.indexOf('--print-tale')

if (printSourcesIndex >= 0) {
  printSources(args[printSourcesIndex + 1] ?? '')
} else if (printTaleIndex >= 0) {
  printTale(args[printTaleIndex + 1] ?? '', args.includes('--full'))
} else {
  await exportDocs()
}
