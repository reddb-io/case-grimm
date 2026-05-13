// ingest-words.ts — tokenise every tale's raw text and persist word /
// bigram / vocab stats into RedDB, alongside the existing graph.
//
// Showcases the document/table model, KV metadata, and probabilistic
// structures (HLL / SKETCH / FILTER) living in the same .rdb file as the
// graph and the timeseries ingest log.
//
// Usage:
//   pnpm ingest:words           # re-ingest into the committed snapshot
//   REDDB_URI=memory:// pnpm ingest:words   # transient
//
// Collections produced:
//   tale_words    (tale, word, freq)        — per-tale unigram counts
//   tale_bigrams  (tale, bigram, freq)      — per-tale bigram counts
//   tale_vocab    (tale, total_tokens, unique_words)
//   vocab_hll     HLL of every token (engine-level cardinality structure)
//   word_sketch   SKETCH of every token     (count-min structure)
//   word_filter   FILTER of every word      (bloom filter)
//
// Plus KV metadata under kv_default:
//   corpus:version, corpus:last_ingest_at, corpus:source, corpus:total_tokens

import { connect, RedDBError } from '@reddb-io/sdk'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..', '..')
const outDir = resolve(repoRoot, 'output')
const dbFile = resolve(outDir, 'embedded.rdb')
const uri = process.env.REDDB_URI ?? `file://${dbFile}`

// Common English stopwords + a few corpus-specific ones (archaic forms).
const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','of','to','in','on','at','by','for','with','from','as','is','are','was','were',
  'be','been','being','have','has','had','having','do','does','did','done','doing','will','would','could','should',
  'may','might','must','shall','can','this','that','these','those','it','its','he','she','they','we','i','you','him',
  'her','his','their','them','my','me','our','your','us','who','what','when','where','why','how','which','than','so',
  'no','not','yes','then','there','here','now','also','too','very','just','like','about','into','out','up','down',
  'over','under','again','more','most','some','any','all','only','own','same','such','one','two','said','say','says',
  'thou','thee','thy','thine','ye','art','wert','wast','hath','dost','doth','shalt','wilt','unto','upon','among',
  'while','until','before','after','because','though','although','since','yet','still','ever','never','always',
  'good','great','little','old','new','long','first','last','many','much','well','away','back','off','about',
  'came','come','went','go','goes','going','gone','let','lets','take','took','taken','give','given','gave','make','made',
  'see','saw','seen','look','looked','looking','tell','told','telling','know','knew','known','knowing','think','thought',
  'find','found','put','set','run','ran','running','am','o','oh','ah','ha',
])

interface Stats {
  totalTokens: number
  vocab: Set<string>
  perTaleUnique: Array<{ tale: string; total: number; unique: number }>
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^['-]+$/.test(w))
}

function bigramsOf(tokens: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`)
  return out
}

function countOccurrences(tokens: string[]): Map<string, number> {
  const c = new Map<string, number>()
  for (const t of tokens) c.set(t, (c.get(t) ?? 0) + 1)
  return c
}

async function dropIfExists(db: import('@reddb-io/sdk').RedDB, name: string): Promise<void> {
  try {
    await db.query(`DROP TABLE ${name}`)
  } catch {
    /* ignore */
  }
}

async function ensure(db: import('@reddb-io/sdk').RedDB, ddl: string): Promise<void> {
  try {
    await db.query(ddl)
  } catch (err) {
    const msg = err instanceof RedDBError ? err.message : String(err)
    if (!/already exists/i.test(msg)) throw err
  }
}

async function main(): Promise<void> {
  console.log(`Connecting to ${uri}`)
  const db = await connect(uri)
  try {
    const talesDir = resolve(repoRoot, 'input/tales')
    const files = readdirSync(talesDir).filter((f) => f.endsWith('.txt'))
    console.log(`Found ${files.length} tale .txt files in ${talesDir}`)

    // Build a mapping from the text-file slug (`hansel-and-gretel`) to the
    // graph's tale label without `_tale` suffix (`hansel_gretel`). The
    // text-file slug and the graph slug do not always match — text files
    // use hyphens and the original verbose title, graph nodes use the
    // curator's shorter underscore-separated form. We pull the tale label
    // out of the sibling .json.
    const slugMap = new Map<string, string>()
    for (const file of files) {
      const slug = basename(file, '.txt')
      try {
        const jsonPath = resolve(talesDir, `${slug}.json`)
        const data = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
          nodes?: Array<{ label: string; node_type: string }>
        }
        const taleNode = (data.nodes ?? []).find((n) => n.node_type === 'tale')
        if (taleNode) slugMap.set(slug, taleNode.label.replace(/_tale$/, ''))
      } catch {
        slugMap.set(slug, slug.replace(/-/g, '_'))
      }
    }

    // Idempotency: wipe any prior word ingest so we can re-run cleanly.
    for (const t of ['tale_words', 'tale_bigrams', 'tale_vocab']) await dropIfExists(db, t)

    // Probabilistic showcase collections — created if missing, kept across runs.
    await ensure(db, 'CREATE HLL vocab_hll')
    await ensure(db, 'CREATE SKETCH word_sketch')
    await ensure(db, 'CREATE FILTER word_filter')

    const stats: Stats = { totalTokens: 0, vocab: new Set(), perTaleUnique: [] }
    let allWordRows: Array<Record<string, unknown>> = []
    let allBigramRows: Array<Record<string, unknown>> = []

    const start = Date.now()
    for (const file of files) {
      const fileSlug = basename(file, '.txt')
      const slug = slugMap.get(fileSlug) ?? fileSlug.replace(/-/g, '_')
      const text = readFileSync(resolve(talesDir, file), 'utf8')
      const tokens = tokenize(text)
      if (!tokens.length) continue
      const wordCounts = countOccurrences(tokens)
      const bigramCounts = countOccurrences(bigramsOf(tokens))

      stats.totalTokens += tokens.length
      for (const w of wordCounts.keys()) stats.vocab.add(w)
      stats.perTaleUnique.push({ tale: slug, total: tokens.length, unique: wordCounts.size })

      // Stage rows; we'll bulk-insert across all tales at the end.
      for (const [word, freq] of wordCounts) {
        allWordRows.push({ tale: slug, word, freq })
      }
      // Cap bigrams at freq ≥ 2 to keep the table compact and meaningful.
      for (const [bigram, freq] of bigramCounts) {
        if (freq < 2) continue
        allBigramRows.push({ tale: slug, bigram, freq })
      }
    }

    console.log(
      `Tokenised: ${stats.totalTokens} tokens, ${stats.vocab.size} unique words across ${stats.perTaleUnique.length} tales`,
    )

    // Bulk-insert per-tale word counts.
    console.log(`Inserting ${allWordRows.length} (tale, word, freq) rows...`)
    const t1 = Date.now()
    for (let i = 0; i < allWordRows.length; i += 500) {
      await db.bulkInsert('tale_words', allWordRows.slice(i, i + 500))
    }
    console.log(`  done in ${Date.now() - t1}ms`)

    // Bulk-insert bigrams.
    console.log(`Inserting ${allBigramRows.length} (tale, bigram, freq) rows...`)
    const t2 = Date.now()
    for (let i = 0; i < allBigramRows.length; i += 500) {
      await db.bulkInsert('tale_bigrams', allBigramRows.slice(i, i + 500))
    }
    console.log(`  done in ${Date.now() - t2}ms`)

    // Vocab summary per tale.
    console.log(`Inserting ${stats.perTaleUnique.length} tale_vocab rows...`)
    await db.bulkInsert(
      'tale_vocab',
      stats.perTaleUnique.map((r) => ({
        tale: r.tale,
        total_tokens: r.total,
        unique_words: r.unique,
      })),
    )

    // Probabilistic feeds — push every unique word into HLL / FILTER, and
    // every token (with repeats) into SKETCH. The v1.0.8 engine does not
    // surface these structures' interrogation API through the SDK, so we
    // populate them and let `SHOW COLLECTIONS` confirm they exist. Future
    // versions of the engine will let us query estimates back.
    console.log('Feeding HLL / SKETCH / FILTER (showcase)...')
    const uniqueWords = [...stats.vocab]
    for (let i = 0; i < uniqueWords.length; i += 200) {
      const chunk = uniqueWords.slice(i, i + 200)
      const tuples = chunk.map((w) => `(${sqlString(w)})`).join(', ')
      await db.query(`INSERT INTO vocab_hll (value) VALUES ${tuples}`)
      await db.query(`INSERT INTO word_filter (value) VALUES ${tuples}`)
    }
    // sketch gets every token occurrence
    const allTokens = allWordRows.flatMap((r) => Array((r.freq as number)).fill(r.word))
    for (let i = 0; i < allTokens.length; i += 500) {
      const chunk = allTokens.slice(i, i + 500)
      const tuples = chunk.map((w) => `(${sqlString(w as string)})`).join(', ')
      await db.query(`INSERT INTO word_sketch (value) VALUES ${tuples}`)
    }

    // KV metadata. Showcases the kv model — corpus-level facts live here.
    console.log('Writing KV metadata...')
    await db.kv.put('corpus:version', '1.0.0')
    await db.kv.put('corpus:last_ingest_at', Date.now())
    await db.kv.put('corpus:source', 'https://www.gutenberg.org/cache/epub/2591/pg2591.txt')
    await db.kv.put('corpus:total_tokens', stats.totalTokens)
    await db.kv.put('corpus:unique_vocab', stats.vocab.size)
    await db.kv.put('corpus:tales', stats.perTaleUnique.length)

    console.log(`\nAll done in ${Date.now() - start}ms`)
  } finally {
    await db.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
