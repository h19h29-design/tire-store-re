import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PORT = Number(process.env.PORT || 4174)
const DATA_DIR = path.resolve(process.env.QUOTE_API_DATA_DIR || path.join(__dirname, '..', '.quote-api-data'))
const FEED_PATH = path.join(DATA_DIR, 'quote-feed.json')
const INQUIRIES_PATH = path.join(DATA_DIR, 'quote-inquiries.json')
const AUTH_KEY = (process.env.QUOTE_API_AUTH_KEY || '').trim()

const defaultFeed = {
  store: {
    storeName: '타이어스토어 식사점',
    serviceArea: '일산 · 파주',
    phoneNumber: '',
    kakaoUrl: '',
    naverStoreUrl: 'https://smartstore.naver.com/tire_sotre',
    defaultInstallationFee: 0,
    defaultAlignmentFee: 0,
    quoteNotice: '재고 및 최종 금액은 상담 후 확정됩니다.',
  },
  lastPublishedAt: null,
  items: [],
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true })
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return fallbackValue
    }

    throw error
  }
}

async function writeJsonFile(filePath, value) {
  await ensureDataDir()
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  setCorsHeaders(response)
  response.end(JSON.stringify(payload))
}

function isAuthorized(request) {
  if (!AUTH_KEY) {
    return true
  }

  const header = request.headers.authorization || ''
  return header === `Bearer ${AUTH_KEY}`
}

async function readRequestBody(request) {
  const chunks = []
  let totalBytes = 0

  for await (const chunk of request) {
    totalBytes += chunk.length
    if (totalBytes > 1024 * 1024) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      throw error
    }

    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Invalid JSON body.')
    error.statusCode = 400
    throw error
  }
}

function validatePublishedFeed(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Feed payload must be a JSON object.'
  }

  if (!payload.store || typeof payload.store !== 'object') {
    return 'Feed payload must include store information.'
  }

  if (!Array.isArray(payload.items)) {
    return 'Feed payload must include an items array.'
  }

  return ''
}

function validateInquiry(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Inquiry payload must be a JSON object.'
  }

  if (!String(payload.customerName || '').trim()) {
    return 'Customer name is required.'
  }

  if (!String(payload.phone || '').trim()) {
    return 'Phone number is required.'
  }

  if (!payload.estimate || typeof payload.estimate !== 'object') {
    return 'Estimate snapshot is required.'
  }

  return ''
}

async function handleGetQuoteFeed(response) {
  const feed = await readJsonFile(FEED_PATH, defaultFeed)
  sendJson(response, 200, {
    ...defaultFeed,
    ...feed,
    store: {
      ...defaultFeed.store,
      ...(feed.store || {}),
    },
    items: Array.isArray(feed.items) ? feed.items : [],
  })
}

async function handlePublishQuoteFeed(request, response) {
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: 'Unauthorized' })
    return
  }

  const payload = await readRequestBody(request)
  const errorMessage = validatePublishedFeed(payload)
  if (errorMessage) {
    sendJson(response, 400, { error: errorMessage })
    return
  }

  const publishedAt = String(payload.lastPublishedAt || new Date().toISOString())
  const nextFeed = {
    ...defaultFeed,
    ...payload,
    lastPublishedAt: publishedAt,
    store: {
      ...defaultFeed.store,
      ...(payload.store || {}),
    },
    items: payload.items,
  }

  await writeJsonFile(FEED_PATH, nextFeed)
  sendJson(response, 200, {
    ok: true,
    publishedAt,
    itemCount: nextFeed.items.length,
  })
}

async function handlePostQuoteInquiry(request, response) {
  const payload = await readRequestBody(request)
  const errorMessage = validateInquiry(payload)
  if (errorMessage) {
    sendJson(response, 400, { error: errorMessage })
    return
  }

  const inquiries = await readJsonFile(INQUIRIES_PATH, [])
  const storedAt = new Date().toISOString()
  const record = {
    id: randomUUID(),
    storedAt,
    ...payload,
  }

  await writeJsonFile(INQUIRIES_PATH, Array.isArray(inquiries) ? [...inquiries, record] : [record])
  sendJson(response, 201, {
    id: record.id,
    storedAt,
  })
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)

    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      setCorsHeaders(response)
      response.end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/quote-feed') {
      await handleGetQuoteFeed(response)
      return
    }

    if (request.method === 'POST' && url.pathname === '/quote-feed/publish') {
      await handlePublishQuoteFeed(request, response)
      return
    }

    if (request.method === 'POST' && url.pathname === '/quote-inquiries') {
      await handlePostQuoteInquiry(request, response)
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    console.error('[quote-api]', error)
    const statusCode =
      error && typeof error === 'object' && 'statusCode' in error && Number.isFinite(error.statusCode)
        ? Number(error.statusCode)
        : 500
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : 'Unexpected server error',
    })
  }
})

await ensureDataDir()
server.listen(PORT, () => {
  console.log(`[quote-api] listening on http://127.0.0.1:${PORT}`)
  console.log(`[quote-api] data dir: ${DATA_DIR}`)
})
