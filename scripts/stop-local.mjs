import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const runStatePath = path.join(rootDir, '.local-run', 'dev-local.json')

function log(message) {
  process.stdout.write(`[stop-local] ${message}\n`)
}

async function main() {
  let state

  try {
    state = JSON.parse(await readFile(runStatePath, 'utf8'))
  } catch {
    log('No local dev process record was found.')
    return
  }

  const pids = new Set([
    ...((Array.isArray(state.childPids) ? state.childPids : []).filter((value) => Number.isFinite(value))),
    ...(Number.isFinite(state.pid) ? [state.pid] : []),
  ])

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
      log(`Stopped PID ${pid}`)
    } catch {
      // Ignore already exited processes.
    }
  }

  await rm(runStatePath, { force: true })
}

await main()
