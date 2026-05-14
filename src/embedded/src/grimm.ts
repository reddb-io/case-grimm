import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCLI } from 'cli-args-parser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const embeddedRoot = resolve(__dirname, '..')
const repoRoot = resolve(embeddedRoot, '..', '..')

type RunOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

function cliString(value: unknown): string {
  if (Array.isArray(value)) return value.map((part) => String(part)).join(' ')
  return String(value ?? '')
}

function run(command: string, args: string[], options: RunOptions = {}): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function runRoot(args: string[]): void {
  run('pnpm', args, { cwd: repoRoot })
}

function runEmbedded(args: string[]): void {
  run('pnpm', args, { cwd: embeddedRoot })
}

function rawArgsAfter(command: string): string[] {
  const argv = process.argv.slice(2)
  const idx = argv.indexOf(command)
  return idx >= 0 ? argv.slice(idx + 1) : []
}

const questions: Record<string, {
  question: string
  answer: string
  models: string[]
  run: () => void
}> = {
  predators: {
    question: 'Which predators play the same narrative role across species?',
    answer: 'Predator roles cross species boundaries: wolves, witches, and human bridegrooms can occupy the same narrative machinery of deception, capture, devouring, and threshold danger.',
    models: ['graph', 'statistics'],
    run: () => runEmbedded(['insights', 'match', 'arc_predator']),
  },
  'tale-machinery': {
    question: 'Which tales share the same narrative machinery?',
    answer: 'Similarity over curated fingerprints surfaces tales that look different in prose but reuse the same structural ingredients: role, place, number, theme, and object patterns.',
    models: ['graph', 'statistics'],
    run: () => runEmbedded(['insights', 'recommend', 'cinderella']),
  },
  'devouring-words': {
    question: 'Can raw word tables ground a narrative pattern?',
    answer: 'The word tables let us check where a concrete motif appears in the canonical corpus without leaving the same embedded RedDB file.',
    models: ['tables', 'statistics'],
    run: () => runEmbedded(['insights', 'words', '--word', 'wolf', '--top', '10']),
  },
  'central-concepts': {
    question: 'What is structurally central in the corpus?',
    answer: 'Degree centrality shows which concepts and entities bind the corpus together across hundreds of tales and thousands of relationships.',
    models: ['graph'],
    run: () => runEmbedded(['query', 'GRAPH CENTRALITY']),
  },
  'propp-hansel': {
    question: 'How does one tale unfold as narrative functions?',
    answer: 'Propp events materialize a tale as ordered narrative functions, with actors, scenes, and textual evidence attached as graph properties.',
    models: ['graph'],
    run: () => runEmbedded(['query', "MATCH (n) WHERE n.label = 'propp_hansel_and_gretel_09' RETURN n.propp_order, n.propp_function, n.actor, n.scene"]),
  },
  provenance: {
    question: 'Which books and source versions feed this canonical tale?',
    answer: 'The gold corpus keeps the canonical tale separate from its book sources, while retaining source references for provenance and comparison.',
    models: ['KV', 'gold corpus'],
    run: () => run('pnpm', ['exec', 'tsx', 'src/export-docs.ts', '--print-sources', 'hansel-and-gretel'], { cwd: embeddedRoot }),
  },
  ingest: {
    question: 'What did the ingest write, and how expensive was it?',
    answer: 'The embedded database records ingest metrics as timeseries rows, so the demo can inspect its own import cost.',
    models: ['timeseries', 'KV'],
    run: () => runEmbedded(['insights', 'logs']),
  },
}

function listQuestions(): void {
  console.log('Curated questions:\n')
  for (const [id, q] of Object.entries(questions)) {
    console.log(`  ${id.padEnd(18)} ${q.question}`)
  }
  console.log('\nRun one with: ./grimm ask <id>')
}

function ask(id: string | undefined): void {
  if (!id) {
    listQuestions()
    return
  }
  const item = questions[id]
  if (!item) {
    console.error(`Unknown question '${id}'.\n`)
    listQuestions()
    process.exit(1)
  }

  console.log(`Q: ${item.question}\n`)
  console.log(`A: ${item.answer}\n`)
  console.log(`RedDB used: ${item.models.join(', ')}\n`)
  item.run()
}

function rebuild(): void {
  runRoot(['run', 'build:corpus'])
  runRoot(['run', 'validate'])
  runEmbedded(['ingest:words'])
  runEmbedded(['start'])
}

const cli = createCLI({
  name: 'grimm',
  version: '1.0.0',
  description: 'Embedded RedDB showcase CLI for the Grimm fairy-tale corpus.',
  commands: {
    setup: {
      description: 'Install root and embedded dependencies.',
      handler: () => {
        runRoot(['install'])
        runEmbedded(['install'])
      },
    },
    rebuild: {
      description: 'Rebuild corpus metadata, validate gold, ingest word tables, then ingest the graph.',
      handler: () => rebuild(),
    },
    about: {
      description: 'Show corpus metadata and RedDB collections.',
      handler: () => runEmbedded(['insights', 'about']),
    },
    query: {
      description: 'Run a raw SQL/GRAPH query against output/embedded.rdb.',
      positional: [{
        name: 'sql',
        required: true,
        variadic: true,
        description: 'SQL or GRAPH command.',
      }],
      handler: (r) => {
        runEmbedded(['query', cliString(r.positional.sql)])
      },
    },
    insights: {
      description: 'Pass through to the existing insights CLI.',
      positional: [{
        name: 'args',
        variadic: true,
        description: 'Arguments for insights.',
      }],
      handler: (r) => {
        runEmbedded(['insights', ...rawArgsAfter('insights')])
      },
    },
    ask: {
      description: 'Run a curated showcase question.',
      positional: [{
        name: 'id',
        description: 'Question id. Omit to list available questions.',
      }],
      handler: (r) => ask(r.positional.id ? String(r.positional.id) : undefined),
    },
    read: {
      description: 'Print a canonical gold tale excerpt and source provenance.',
      positional: [{
        name: 'slug',
        required: true,
        description: 'Canonical tale slug, e.g. hansel-and-gretel.',
      }],
      options: {
        full: { type: 'boolean', description: 'Print the full canonical text.' },
      },
      handler: (r) => {
        const args = ['exec', 'tsx', 'src/export-docs.ts', '--print-tale', String(r.positional.slug)]
        if (r.options.full) args.push('--full')
        run('pnpm', args, { cwd: embeddedRoot })
      },
    },
    export: {
      description: 'Export generated artifacts.',
      positional: [{
        name: 'target',
        required: true,
        validate: (value: unknown) => cliString(value) === 'docs' || 'target must be docs',
      }],
      handler: () => run('pnpm', ['exec', 'tsx', 'src/export-docs.ts'], { cwd: embeddedRoot }),
    },
    docs: {
      description: 'Docs helper commands.',
      positional: [{
        name: 'action',
        required: true,
        validate: (value: unknown) => cliString(value) === 'serve' || 'action must be serve',
      }],
      options: {
        port: { type: 'number', short: 'p', default: 4173, description: 'Local docs port.' },
      },
      handler: (r) => {
        run('python3', ['-m', 'http.server', String(r.options.port), '-d', 'docs'], { cwd: repoRoot })
      },
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
