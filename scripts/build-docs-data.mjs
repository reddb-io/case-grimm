import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const result = spawnSync('pnpm', ['--dir', 'src/embedded', 'exec', 'tsx', 'src/export-docs.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
})

if (result.error) throw result.error
process.exit(result.status ?? 0)
