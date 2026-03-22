import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const runDir = path.join(rootDir, '.local-run')
const runStatePath = path.join(runDir, 'dev-local.json')
const dataDir = path.join(rootDir, '.quote-api-data')
const feedPath = path.join(dataDir, 'quote-feed.json')
const childPids = []

function log(message) {
  process.stdout.write(`[dev-local] ${message}\n`)
}

async function ensureSeedFeed() {
  await mkdir(dataDir, { recursive: true })

  try {
    await stat(feedPath)
    return
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  const seedFeed = {
    store: {
      storeName: '타이어스토어 식사점',
      serviceArea: '일산 · 파주',
      phoneNumber: '010-0000-0000',
      kakaoUrl: '',
      naverStoreUrl: 'https://smartstore.naver.com/tire_sotre',
      defaultInstallationFee: 15000,
      defaultAlignmentFee: 50000,
      quoteNotice: '로컬 테스트 데이터입니다. 실제 재고 및 최종 금액은 상담 후 확정됩니다.',
    },
    lastPublishedAt: new Date().toISOString(),
    items: [
      {
        skuCode: 'LOCAL-HT-2254517',
        brandName: '한국타이어',
        patternName: 'Ventus Prime4',
        sizeLabel: '225/45R17',
        productName: '벤투스 프라임4',
        quoteUnitPrice: 142000,
        quoteAvailable: true,
        publicQuoteUrl: 'https://smartstore.naver.com/tire_sotre',
        searchText: '한국타이어 벤투스 프라임4 225/45R17 쏘나타 K5 아반떼',
      },
      {
        skuCode: 'LOCAL-NX-2355519',
        brandName: '넥센타이어',
        patternName: 'Nfera Supreme',
        sizeLabel: '235/55R19',
        productName: '엔페라 슈프림',
        quoteUnitPrice: 168000,
        quoteAvailable: true,
        publicQuoteUrl: 'https://smartstore.naver.com/tire_sotre',
        searchText: '넥센타이어 엔페라 슈프림 235/55R19 쏘렌토 싼타페 SUV',
      },
      {
        skuCode: 'LOCAL-KH-1956515',
        brandName: '금호타이어',
        patternName: 'Solus TA51',
        sizeLabel: '195/65R15',
        productName: '솔루스 TA51',
        quoteUnitPrice: 89000,
        quoteAvailable: false,
        publicQuoteUrl: 'https://smartstore.naver.com/tire_sotre',
        searchText: '금호타이어 솔루스 TA51 195/65R15 아반떼 K3',
      },
    ],
  }

  await writeFile(feedPath, `${JSON.stringify(seedFeed, null, 2)}\n`, 'utf8')
  log('No published feed was found, so a local sample quote feed was created.')
}

async function canReach(url) {
  try {
    const response = await fetch(url)
    return response.ok || response.status < 500
  } catch {
    return false
  }
}

function spawnManagedProcess(command, label) {
  const child = spawn(command, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
    },
  })

  childPids.push(child.pid)
  child.on('exit', (code, signal) => {
    log(`${label} exited (${signal || code || 0}).`)
  })
  return child
}

async function writeRunState() {
  await mkdir(runDir, { recursive: true })
  await writeFile(
    runStatePath,
    `${JSON.stringify(
      {
        pid: process.pid,
        childPids,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

async function cleanupRunState() {
  try {
    await rm(runStatePath, { force: true })
  } catch {
    // Ignore cleanup failures on shutdown.
  }
}

async function start() {
  await ensureSeedFeed()

  const apiRunning = await canReach('http://127.0.0.1:4174/quote-feed')
  if (!apiRunning) {
    spawnManagedProcess('npm run quote:api', 'Quote API')
    log('Starting quote API on http://127.0.0.1:4174')
  } else {
    log('Quote API already appears to be running on http://127.0.0.1:4174')
  }

  const viteRunning = await canReach('http://127.0.0.1:5173')
  if (!viteRunning) {
    spawnManagedProcess('npm run dev -- --host 127.0.0.1', 'Vite dev server')
    log('Starting Vite on http://127.0.0.1:5173')
  } else {
    log('Vite already appears to be running on http://127.0.0.1:5173')
  }

  await writeRunState()
  log('Local web stack is ready.')
  log('Homepage: http://127.0.0.1:5173')
  log('Quote API: http://127.0.0.1:4174/quote-feed')
}

function shutdown(signal) {
  log(`Stopping local services (${signal})...`)
  for (const pid of childPids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Ignore already exited children.
    }
  }

  void cleanupRunState().finally(() => {
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('exit', () => {
  void cleanupRunState()
})

await start()
