import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PORT = Number(process.env.API_PORT || process.env.BILLING_API_PORT || 3100)
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ||
  process.env.BILLING_API_BASE_URL?.replace(/\/+$/, '') ||
  `http://127.0.0.1:${PORT}`
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'dev-admin-token')
const DATA_DIR = path.resolve(process.env.LITIRE_DATA_DIR || path.join(__dirname, '..', '.billing-api-data'))
const STORAGE_DIR = path.resolve(process.env.UPDATE_STORAGE_DIR || path.join(__dirname, 'storage', 'updates'))
const DATA_PATH = path.join(DATA_DIR, 'litire-license-data.json')
const DAY_MS = 24 * 60 * 60 * 1000

const defaultData = {
  version: 1,
  licenses: [],
  devices: [],
  checkLogs: [],
  releases: [],
}

if (!ADMIN_TOKEN) {
  throw new Error('ADMIN_TOKEN is required when NODE_ENV=production.')
}

function nowIso() {
  return new Date().toISOString()
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + days * DAY_MS).toISOString()
}

function generateLicenseKey() {
  return `LITIRE-${randomBytes(3).toString('hex').toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function ensureDirs() {
  await mkdir(DATA_DIR, { recursive: true })
  await mkdir(STORAGE_DIR, { recursive: true })
}

async function readData() {
  try {
    const raw = await readFile(DATA_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      ...defaultData,
      ...parsed,
      licenses: Array.isArray(parsed?.licenses) ? parsed.licenses : [],
      devices: Array.isArray(parsed?.devices) ? parsed.devices : [],
      checkLogs: Array.isArray(parsed?.checkLogs) ? parsed.checkLogs : [],
      releases: Array.isArray(parsed?.releases) ? parsed.releases : [],
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { ...defaultData }
    }
    throw error
  }
}

async function writeData(data) {
  await ensureDirs()
  await writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
}

function sendJson(response, statusCode, payload) {
  setCors(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function sendHtml(response, statusCode, html) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(html)
}

async function readBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > 120 * 1024 * 1024) {
      const error = new Error('요청 본문이 너무 큽니다.')
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
    const error = new Error('JSON 형식이 올바르지 않습니다.')
    error.statusCode = 400
    throw error
  }
}

function isAdmin(request, url) {
  const token = request.headers['x-admin-token'] || url.searchParams.get('adminToken')
  return String(token || '') === ADMIN_TOKEN
}

function licenseState(license) {
  const expiresAtMs = Date.parse(license.expiresAt || '')
  const graceEndsAtMs = Date.parse(license.graceEndsAt || '')
  const now = Date.now()

  if (license.status === 'suspended' || license.status === 'revoked') {
    return { ok: false, status: license.status, message: '라이선스가 중지되었습니다.' }
  }
  if (Number.isFinite(expiresAtMs) && now > expiresAtMs) {
    if (Number.isFinite(graceEndsAtMs) && now <= graceEndsAtMs) {
      return {
        ok: true,
        status: 'grace_period',
        message: '라이선스가 만료되었지만 유예 기간으로 동작합니다.',
      }
    }
    return { ok: false, status: 'expired', message: '라이선스 기간이 만료되었습니다.' }
  }
  if (license.status === 'trial' || license.status === 'active') {
    return { ok: true, status: license.status, message: '라이선스가 확인되었습니다.' }
  }
  return { ok: false, status: license.status || 'inactive', message: '사용할 수 없는 라이선스입니다.' }
}

function toLicenseResponse(license, state, deviceId = '') {
  const graceEndsAt = license.graceEndsAt || addDays(license.expiresAt || nowIso(), license.offlineGraceDays || 7)
  const graceRemainingDays = Math.max(0, Math.ceil((Date.parse(graceEndsAt) - Date.now()) / DAY_MS))
  return {
    ok: Boolean(state.ok),
    email: license.email,
    licenseKey: license.licenseKey,
    status: state.status,
    message: state.message,
    expiresAt: license.expiresAt || null,
    offlineGraceDays: license.offlineGraceDays || 7,
    isInGracePeriod: state.status === 'grace_period',
    graceRemainingDays: state.status === 'grace_period' ? graceRemainingDays : null,
    graceEndsAt,
    checkedAt: nowIso(),
    deviceId,
  }
}

function findLicense(data, email, licenseKey) {
  return data.licenses.find(
    (license) => license.email === normalizeEmail(email) && String(license.licenseKey) === String(licenseKey || '').trim(),
  )
}

function activeDevicesForLicense(data, licenseKey, excludeDeviceId = '') {
  return data.devices.filter(
    (device) => device.licenseKey === licenseKey && device.isActive !== false && device.deviceId !== excludeDeviceId,
  )
}

function compareVersions(left, right) {
  const leftParts = String(left || '0.0.0').split(/[.-]/)
  const rightParts = String(right || '0.0.0').split(/[.-]/)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(leftParts[index] || 0)
    const rightValue = Number(rightParts[index] || 0)
    if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1
    }
    const leftText = String(leftParts[index] || '')
    const rightText = String(rightParts[index] || '')
    if (leftText !== rightText) {
      return leftText > rightText ? 1 : -1
    }
  }
  return 0
}

function latestRelease(data, channel, target, arch) {
  return data.releases
    .filter(
      (release) =>
        release.isActive !== false &&
        release.channel === channel &&
        release.target === target &&
        release.arch === arch,
    )
    .sort((left, right) => compareVersions(right.version, left.version) || String(right.createdAt).localeCompare(String(left.createdAt)))[0]
}

function releaseManifest(release, currentVersion = '0.0.0') {
  const url = release ? `${PUBLIC_BASE_URL}/updates/${encodeURIComponent(release.channel)}/${encodeURIComponent(release.fileName)}` : ''
  return {
    ok: true,
    updateAvailable: release ? compareVersions(release.version, currentVersion) > 0 : false,
    currentVersion,
    version: release?.version || currentVersion,
    channel: release?.channel || 'stable',
    notes: release?.notes || '',
    pubDate: release?.createdAt || nowIso(),
    url,
    signature: release?.signature || '',
    isRequired: Boolean(release?.isRequired),
    fileName: release?.fileName || '',
  }
}

function renderAdmin() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Litire License Admin</title>
  <style>
    body { margin: 0; font-family: "Malgun Gothic", sans-serif; background: #f7f7f4; color: #171717; }
    main { max-width: 980px; margin: 32px auto; padding: 0 16px; display: grid; gap: 18px; }
    section { background: white; border: 1px solid #ddd; border-radius: 8px; padding: 18px; }
    input, select, textarea, button { font: inherit; padding: 10px; border: 1px solid #ccc; border-radius: 6px; }
    button { background: #1f5f8b; color: white; border: 0; cursor: pointer; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .wide { grid-column: 1 / -1; }
    pre { white-space: pre-wrap; background: #f2f4f5; padding: 12px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <h1>Litire 라이선스 / 업데이트 관리</h1>
    <section>
      <h2>라이선스 발급</h2>
      <div class="grid">
        <input id="token" placeholder="관리자 토큰" />
        <input id="email" placeholder="아이디 또는 이메일" />
        <select id="status"><option value="active">active</option><option value="trial">trial</option><option value="suspended">suspended</option></select>
        <input id="seats" type="number" value="1" min="1" />
        <input id="expiresAt" type="datetime-local" />
        <input id="memo" placeholder="메모" />
        <button onclick="createLicense()">발급</button>
        <button onclick="listLicenses()">목록 보기</button>
      </div>
    </section>
    <section>
      <h2>업데이트 등록</h2>
      <div class="grid">
        <input id="version" placeholder="버전 예: 1.5.1" />
        <input id="fileName" placeholder="파일명 예: Tire Store_1.5.1_x64-setup.exe" />
        <input id="signature" placeholder="Tauri 서명" />
        <input id="channel" value="stable" />
        <textarea id="notes" class="wide" placeholder="업데이트 내용"></textarea>
        <textarea id="fileBase64" class="wide" placeholder="파일 base64, 비워두면 파일명만 등록"></textarea>
        <button onclick="createRelease()">업데이트 등록</button>
        <button onclick="listReleases()">업데이트 목록</button>
      </div>
    </section>
    <section><h2>결과</h2><pre id="out"></pre></section>
  </main>
  <script>
    const out = document.getElementById('out');
    const token = () => document.getElementById('token').value;
    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token(), ...(options.headers || {}) },
      });
      const data = await response.json();
      out.textContent = JSON.stringify(data, null, 2);
      return data;
    }
    function isoFromLocal(value) { return value ? new Date(value).toISOString() : null; }
    async function createLicense() {
      await api('/admin/licenses', { method: 'POST', body: JSON.stringify({
        email: document.getElementById('email').value,
        status: document.getElementById('status').value,
        seats: Number(document.getElementById('seats').value || 1),
        expiresAt: isoFromLocal(document.getElementById('expiresAt').value),
        memo: document.getElementById('memo').value
      })});
    }
    async function listLicenses() { await api('/admin/licenses'); }
    async function createRelease() {
      await api('/admin/releases', { method: 'POST', body: JSON.stringify({
        version: document.getElementById('version').value,
        fileName: document.getElementById('fileName').value,
        signature: document.getElementById('signature').value,
        channel: document.getElementById('channel').value || 'stable',
        notes: document.getElementById('notes').value,
        fileBase64: document.getElementById('fileBase64').value,
      })});
    }
    async function listReleases() { await api('/admin/releases'); }
  </script>
</body>
</html>`
}

async function handleLicenseActivate(request, response) {
  const body = await readBody(request)
  const email = normalizeEmail(body.email)
  const licenseKey = String(body.licenseKey || '').trim()
  const deviceId = String(body.deviceId || '').trim()
  const deviceName = String(body.deviceName || '').trim()
  if (!email || !licenseKey || !deviceId) {
    sendJson(response, 400, { ok: false, message: '아이디, 라이선스 키, 기기 ID가 필요합니다.' })
    return
  }

  const data = await readData()
  const license = findLicense(data, email, licenseKey)
  if (!license) {
    sendJson(response, 403, { ok: false, status: 'not_found', message: '라이선스를 찾을 수 없습니다.' })
    return
  }

  const state = licenseState(license)
  if (!state.ok) {
    data.checkLogs.push({ licenseKey, deviceId, result: state.status, appVersion: body.appVersion || '', checkedAt: nowIso() })
    await writeData(data)
    sendJson(response, 403, toLicenseResponse(license, state, deviceId))
    return
  }

  const existing = data.devices.find((device) => device.licenseKey === licenseKey && device.deviceId === deviceId)
  if (!existing && activeDevicesForLicense(data, licenseKey, deviceId).length >= Number(license.seats || 1)) {
    const limitState = { ok: false, status: 'device_limit', message: '사용 가능한 기기 수를 초과했습니다.' }
    data.checkLogs.push({ licenseKey, deviceId, result: 'device_limit', appVersion: body.appVersion || '', checkedAt: nowIso() })
    await writeData(data)
    sendJson(response, 403, toLicenseResponse(license, limitState, deviceId))
    return
  }

  if (existing) {
    existing.deviceName = deviceName
    existing.appVersion = body.appVersion || existing.appVersion || ''
    existing.lastCheckedAt = nowIso()
    existing.isActive = true
  } else {
    data.devices.push({
      licenseKey,
      deviceId,
      deviceName,
      appVersion: body.appVersion || '',
      activatedAt: nowIso(),
      lastCheckedAt: nowIso(),
      isActive: true,
    })
  }
  data.checkLogs.push({ licenseKey, deviceId, result: state.status, appVersion: body.appVersion || '', checkedAt: nowIso() })
  await writeData(data)
  sendJson(response, 200, toLicenseResponse(license, state, deviceId))
}

async function handleLicenseCheck(request, response) {
  const body = await readBody(request)
  const data = await readData()
  const license = findLicense(data, body.email, body.licenseKey)
  const deviceId = String(body.deviceId || '').trim()
  if (!license) {
    sendJson(response, 403, { ok: false, status: 'not_found', message: '라이선스를 찾을 수 없습니다.' })
    return
  }
  const device = data.devices.find(
    (entry) => entry.licenseKey === license.licenseKey && entry.deviceId === deviceId && entry.isActive !== false,
  )
  if (!device) {
    sendJson(response, 403, toLicenseResponse(license, { ok: false, status: 'not_activated', message: '이 기기에서 활성화되지 않았습니다.' }, deviceId))
    return
  }
  const state = licenseState(license)
  device.lastCheckedAt = nowIso()
  device.appVersion = body.appVersion || device.appVersion || ''
  data.checkLogs.push({ licenseKey: license.licenseKey, deviceId, result: state.status, appVersion: body.appVersion || '', checkedAt: nowIso() })
  await writeData(data)
  sendJson(response, state.ok ? 200 : 403, toLicenseResponse(license, state, deviceId))
}

async function handleCreateLicense(request, response) {
  const body = await readBody(request)
  const email = normalizeEmail(body.email)
  if (!email) {
    sendJson(response, 400, { ok: false, message: '아이디 또는 이메일을 입력해 주세요.' })
    return
  }
  const now = nowIso()
  const expiresAt = body.expiresAt || addDays(now, Number(body.serviceDays || 30))
  const license = {
    email,
    licenseKey: String(body.licenseKey || generateLicenseKey()).trim(),
    status: body.status || 'active',
    seats: Math.max(1, Number(body.seats || 1)),
    expiresAt,
    graceEndsAt: addDays(expiresAt, Number(body.offlineGraceDays || 7)),
    offlineGraceDays: Number(body.offlineGraceDays || 7),
    memo: String(body.memo || ''),
    createdAt: now,
    updatedAt: now,
  }
  const data = await readData()
  const existingIndex = data.licenses.findIndex((entry) => entry.licenseKey === license.licenseKey)
  if (existingIndex >= 0) {
    data.licenses[existingIndex] = { ...data.licenses[existingIndex], ...license, createdAt: data.licenses[existingIndex].createdAt, updatedAt: now }
  } else {
    data.licenses.push(license)
  }
  await writeData(data)
  sendJson(response, 200, { ok: true, license })
}

async function handleCreateRelease(request, response) {
  const body = await readBody(request)
  const fileName = path.basename(String(body.fileName || ''))
  const version = String(body.version || '').trim()
  if (!version || !fileName) {
    sendJson(response, 400, { ok: false, message: '버전과 파일명이 필요합니다.' })
    return
  }
  const channel = String(body.channel || 'stable').trim()
  if (body.fileBase64) {
    const releaseDir = path.join(STORAGE_DIR, channel)
    await mkdir(releaseDir, { recursive: true })
    await writeFile(path.join(releaseDir, fileName), Buffer.from(String(body.fileBase64), 'base64'))
  }
  const release = {
    id: randomBytes(8).toString('hex'),
    channel,
    version,
    target: String(body.target || 'windows'),
    arch: String(body.arch || 'x86_64'),
    fileName,
    notes: String(body.notes || ''),
    signature: String(body.signature || ''),
    isRequired: Boolean(body.isRequired),
    isActive: true,
    createdAt: nowIso(),
  }
  const data = await readData()
  data.releases.push(release)
  await writeData(data)
  sendJson(response, 200, { ok: true, release })
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', PUBLIC_BASE_URL)
    if (request.method === 'OPTIONS') {
      setCors(response)
      response.statusCode = 204
      response.end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'litire-license-api', checkedAt: nowIso() })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin') {
      sendHtml(response, 200, renderAdmin())
      return
    }
    if (request.method === 'POST' && url.pathname === '/licenses/activate') {
      await handleLicenseActivate(request, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/licenses/check') {
      await handleLicenseCheck(request, response)
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/licenses') {
      if (!isAdmin(request, url)) {
        sendJson(response, 401, { ok: false, message: '관리자 토큰이 필요합니다.' })
        return
      }
      const data = await readData()
      sendJson(response, 200, { ok: true, licenses: data.licenses, devices: data.devices })
      return
    }
    if (request.method === 'POST' && (url.pathname === '/admin/licenses' || url.pathname === '/admin/dev-license')) {
      if (url.pathname === '/admin/licenses' && !isAdmin(request, url)) {
        sendJson(response, 401, { ok: false, message: '관리자 토큰이 필요합니다.' })
        return
      }
      await handleCreateLicense(request, response)
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/releases') {
      if (!isAdmin(request, url)) {
        sendJson(response, 401, { ok: false, message: '관리자 토큰이 필요합니다.' })
        return
      }
      const data = await readData()
      sendJson(response, 200, { ok: true, releases: data.releases })
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/releases') {
      if (!isAdmin(request, url)) {
        sendJson(response, 401, { ok: false, message: '관리자 토큰이 필요합니다.' })
        return
      }
      await handleCreateRelease(request, response)
      return
    }

    const updateMatch = url.pathname.match(/^\/updates\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/)
    if (request.method === 'GET' && updateMatch) {
      const [, channel, target, arch, currentVersion] = updateMatch
      const data = await readData()
      sendJson(response, 200, releaseManifest(latestRelease(data, channel, target, arch), currentVersion))
      return
    }
    const tauriUpdateMatch = url.pathname.match(/^\/tauri-updates\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/)
    if (request.method === 'GET' && tauriUpdateMatch) {
      const [, channel, target, arch, currentVersion] = tauriUpdateMatch
      const data = await readData()
      const latest = latestRelease(data, channel, target, arch)
      const manifest = releaseManifest(latest, currentVersion)
      if (!manifest.updateAvailable || !manifest.signature) {
        response.statusCode = 204
        response.end()
        return
      }
      sendJson(response, 200, {
        version: manifest.version,
        pub_date: manifest.pubDate,
        url: manifest.url,
        signature: manifest.signature,
        notes: manifest.notes,
      })
      return
    }
    const downloadMatch = url.pathname.match(/^\/updates\/([^/]+)\/([^/]+)$/)
    if (request.method === 'GET' && downloadMatch) {
      const [, channel, fileNameRaw] = downloadMatch
      const filePath = path.join(STORAGE_DIR, channel, path.basename(fileNameRaw))
      try {
        const fileStat = await stat(filePath)
        response.statusCode = 200
        response.setHeader('Content-Length', fileStat.size)
        response.setHeader('Content-Type', 'application/octet-stream')
        createReadStream(filePath).pipe(response)
      } catch {
        sendJson(response, 404, { ok: false, message: '업데이트 파일을 찾을 수 없습니다.' })
      }
      return
    }

    sendJson(response, 404, { ok: false, message: '요청 경로를 찾을 수 없습니다.' })
  } catch (error) {
    console.error(error)
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error instanceof Error ? error.message : '서버 오류가 발생했습니다.',
    })
  }
})

await ensureDirs()
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Litire license server listening on ${PORT}`)
})
