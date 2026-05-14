import { connect, RedDBError } from '@reddb-io/sdk'
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..', '..')

const outDir = resolve(repoRoot, 'output')
const dbFile = resolve(outDir, 'embedded.rdb')
const sql = process.argv.slice(2).join(' ').trim()

if (!sql) {
  console.error('usage: pnpm query "<SQL or GRAPH command>"')
  console.error('')
  console.error('examples:')
  console.error('  pnpm query "SELECT node_type, COUNT(*) FROM tales WHERE node_type IS NOT NULL GROUP BY node_type"')
  console.error('  pnpm query "SELECT label, COUNT(*) FROM tales WHERE node_type IS NULL GROUP BY label"')
  console.error('  pnpm query "GRAPH CENTRALITY"')
  console.error("  pnpm query \"GRAPH NEIGHBORHOOD '128' DIRECTION both\"")
  process.exit(1)
}

function snapshotUri(): { uri: string; cleanup?: () => void } {
  if (process.env.REDDB_URI) return { uri: process.env.REDDB_URI }

  const workDir = mkdtempSync(resolve(tmpdir(), 'grimms-reddb-'))
  for (const entry of readdirSync(outDir)) {
    if (entry.startsWith('embedded.rdb')) {
      copyFileSync(resolve(outDir, entry), resolve(workDir, entry))
    }
  }

  return {
    uri: `file://${resolve(workDir, 'embedded.rdb')}`,
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  }
}

const snapshot = snapshotUri()

function closeInBackground(db: Awaited<ReturnType<typeof connect>>): void {
  db.close().catch(() => {
    // Query output has already been printed; close failures should not hide it.
  })
}

try {
  const db = await connect(snapshot.uri)
  try {
    const result = await db.query(sql)
    const rows = result.rows ?? []

    if (rows.length > 0) {
      console.table(rows)
    } else {
      console.log(JSON.stringify(result, null, 2))
    }
  } finally {
    closeInBackground(db)
    snapshot.cleanup?.()
  }
} catch (err) {
  snapshot.cleanup?.()
  if (err instanceof RedDBError) {
    console.error(`[${err.code}] ${err.message}`)
  } else {
    console.error(err instanceof Error ? err.message : String(err))
  }
  process.exit(1)
}

process.exit(0)
