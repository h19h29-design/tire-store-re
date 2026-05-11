import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { extractUpdateReleaseFromZip } from './updateZip.mjs'

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
const ADMIN_SESSION_COOKIE = 'litire_admin_session'
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const SERVER_VERSION = '1.90.0'
const GOOGLE_DRIVE_CONFIG_SOURCE_URL =
  process.env.GOOGLE_DRIVE_CONFIG_SOURCE_URL?.trim() || 'https://liyaj.h19h19.synology.me/config/public'
const GOOGLE_DRIVE_CONFIG_CACHE_MS = 5 * 60 * 1000
let googleDriveConfigCache = { expiresAt: 0, value: null }

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
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Admin-Token')
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

function sendRedirect(response, location) {
  response.statusCode = 303
  response.setHeader('Location', location)
  response.end()
}

async function readRawBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > 350 * 1024 * 1024) {
      const error = new Error('\uC694\uCCAD \uBCF8\uBB38\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4.')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readBody(request) {
  const rawBody = await readRawBody(request)
  if (rawBody.length === 0) {
    return {}
  }
  try {
    return JSON.parse(rawBody.toString('utf8'))
  } catch {
    const error = new Error('JSON ?類ㅻ뻼????而?몴?? ??녿뮸??덈뼄.')
    error.statusCode = 400
    throw error
  }
}

function isAdmin(request, url) {
  const bearerToken = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const token = bearerToken || request.headers['x-admin-token'] || url.searchParams.get('adminToken')
  if (String(token || '') === ADMIN_TOKEN) return true
  if (verifyAdminSession(token)) return true
  return Boolean(verifyAdminSession(readCookie(request, ADMIN_SESSION_COOKIE)))
}

async function publicConfigPayload() {
  const sharedGoogleDriveConfig = await loadSharedGoogleDriveConfig()
  return {
    ok: true,
    serverVersion: SERVER_VERSION,
    publicApiBaseUrl: PUBLIC_BASE_URL,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleDeviceClientId: process.env.GOOGLE_DEVICE_CLIENT_ID || sharedGoogleDriveConfig.googleDeviceClientId || '',
    googleDeviceClientSecret: process.env.GOOGLE_DEVICE_CLIENT_SECRET || sharedGoogleDriveConfig.googleDeviceClientSecret || '',
  }
}

async function loadSharedGoogleDriveConfig() {
  if (process.env.GOOGLE_DEVICE_CLIENT_ID && process.env.GOOGLE_DEVICE_CLIENT_SECRET) {
    return { googleDeviceClientId: '', googleDeviceClientSecret: '' }
  }
  if (!GOOGLE_DRIVE_CONFIG_SOURCE_URL) {
    return { googleDeviceClientId: '', googleDeviceClientSecret: '' }
  }
  const now = Date.now()
  if (googleDriveConfigCache.value && googleDriveConfigCache.expiresAt > now) {
    return googleDriveConfigCache.value
  }
  try {
    const response = await fetch(GOOGLE_DRIVE_CONFIG_SOURCE_URL)
    const data = await response.json().catch(() => ({}))
    const value = {
      googleDeviceClientId: response.ok ? String(data.googleDeviceClientId || '').trim() : '',
      googleDeviceClientSecret: response.ok ? String(data.googleDeviceClientSecret || '').trim() : '',
    }
    googleDriveConfigCache = { expiresAt: now + GOOGLE_DRIVE_CONFIG_CACHE_MS, value }
    return value
  } catch {
    return { googleDeviceClientId: '', googleDeviceClientSecret: '' }
  }
}

function normalizeChannel(value) {
  const channel = String(value || 'stable')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return channel || 'stable'
}

function readCookie(request, name) {
  const cookie = String(request.headers.cookie || '')
  const prefix = `${name}=`
  const value = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return value ? decodeURIComponent(value.slice(prefix.length)) : ''
}

function signAdminSession() {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS
  const nonce = randomBytes(12).toString('hex')
  const payload = Buffer.from(JSON.stringify({ role: 'admin', expiresAt, nonce }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', ADMIN_TOKEN).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyAdminSession(sessionToken) {
  const [payload, signature] = String(sessionToken || '').split('.')
  if (!payload || !signature) return false
  const expected = createHmac('sha256', ADMIN_TOKEN).update(payload).digest('base64url')
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)
  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) return false
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return session.role === 'admin' && Number(session.expiresAt) > Date.now()
  } catch {
    return false
  }
}

function setAdminSessionCookie(response, sessionToken) {
  response.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      ADMIN_SESSION_TTL_MS / 1000,
    )}`,
  )
}

function clearAdminSessionCookie(response) {
  response.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

function licenseState(license) {
  const expiresAtMs = Date.parse(license.expiresAt || '')
  const graceEndsAtMs = Date.parse(license.graceEndsAt || '')
  const now = Date.now()

  if (license.status === 'suspended' || license.status === 'revoked') {
    return { ok: false, status: license.status, message: '??깆뵠?醫롫뮞揶쎛 餓λ쵐???뤿???щ빍??' }
  }
  if (Number.isFinite(expiresAtMs) && now > expiresAtMs) {
    if (Number.isFinite(graceEndsAtMs) && now <= graceEndsAtMs) {
      return {
        ok: true,
        status: 'grace_period',
        message: '??깆뵠?醫롫뮞揶쎛 筌띾슢利??뤿?筌왖筌??醫롮굙 疫꿸퀗而??곗쨮 ??덉삂??몃빍??',
      }
    }
    return { ok: false, status: 'expired', message: '??깆뵠?醫롫뮞 疫꿸퀗而??筌띾슢利??뤿???щ빍??' }
  }
  if (license.status === 'trial' || license.status === 'active') {
    return { ok: true, status: license.status, message: '??깆뵠?醫롫뮞揶쎛 ?類ㅼ뵥??뤿???щ빍??' }
  }
  return { ok: false, status: license.status || 'inactive', message: '?????????용뮉 ??깆뵠?醫롫뮞??낅빍??' }
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

function sortReleases(releases) {
  return [...releases].sort(
    (left, right) =>
      compareVersions(right.version, left.version) ||
      String(right.createdAt || '').localeCompare(String(left.createdAt || '')) ||
      String(right.id || '').localeCompare(String(left.id || '')),
  )
}

function sortLicenses(licenses) {
  return [...licenses].sort(
    (left, right) =>
      String(right.createdAt || '').localeCompare(String(left.createdAt || '')) ||
      String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')) ||
      String(right.licenseKey || '').localeCompare(String(left.licenseKey || '')),
  )
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

function releaseDto(release) {
  return {
    ...release,
    url: `${PUBLIC_BASE_URL}/updates/${encodeURIComponent(release.channel)}/${encodeURIComponent(release.fileName)}`,
  }
}

function renderHomePage() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Litire server</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: "Malgun Gothic", Arial, sans-serif; background: #f7f7f4; color: #171717; }
    main { width: min(720px, calc(100vw - 32px)); background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 28px; box-shadow: 0 12px 30px rgba(0,0,0,.05); }
    h1 { margin: 0 0 10px; font-size: 32px; line-height: 1.2; }
    p { margin: 0 0 18px; color: #555; line-height: 1.6; }
    .version { margin: 0 0 22px; color: #666; font-size: 14px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 10px 14px; border-radius: 6px; background: #1f5f8b; color: white; text-decoration: none; font-weight: 700; }
    a.secondary { background: #555; }
  </style>
</head>
<body>
  <main>
    <h1>Litire &#48176;&#54252; &#49436;&#48260;</h1>
    <p>&#51088;&#46041; &#50629;&#45936;&#51060;&#53944;, &#46972;&#51060;&#49468;&#49828;, Google Drive &#48177;&#50629; &#49444;&#51221;&#51012; &#44288;&#47532;&#54633;&#45768;&#45796;.</p>
    <div class="version">Server version ${SERVER_VERSION}</div>
    <div class="actions">
      <a href="/admin">&#44288;&#47532;&#51088; &#54168;&#51060;&#51648;</a>
      <a class="secondary" href="/health">&#49436;&#48260; &#49345;&#53468;</a>
    </div>
  </main>
</body>
</html>`
}

function renderAdminLoginPage(message = '') {
  const safeMessage = escapeHtml(message)
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Litire 愿由ъ옄 濡쒓렇??/title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: "Malgun Gothic", Arial, sans-serif; background: #f7f7f4; color: #171717; }
    .panel { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 28px; box-shadow: 0 12px 30px rgba(0,0,0,.05); }
    h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.2; }
    p { margin: 0 0 20px; color: #666; line-height: 1.5; }
    input, button { width: 100%; font: inherit; padding: 12px; border-radius: 6px; }
    input { border: 1px solid #ccc; margin-bottom: 12px; }
    button { border: 0; background: #1f5f8b; color: white; cursor: pointer; font-weight: 700; }
    pre { white-space: pre-wrap; background: #f2f4f5; padding: 12px; border-radius: 6px; margin: 16px 0 0; color: #9a3412; }
  </style>
</head>
<body>
  <form class="panel" method="post" action="/admin/login">
    <h1>愿由ъ옄 濡쒓렇??/h1>
    <p>愿由ъ옄 ?좏겙?쇰줈 濡쒓렇?명븳 ???쇱씠?좎뒪? ?낅뜲?댄듃瑜?愿由ы빀?덈떎.</p>
    <input name="adminToken" type="password" placeholder="愿由ъ옄 ?좏겙" autofocus autocomplete="current-password" />
    <button type="submit">濡쒓렇??/button>
    ${safeMessage ? `<pre>${safeMessage}</pre>` : ''}
  </form>
</body>
</html>`
}
function renderAdminPage() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Litire 愿由ъ옄</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Malgun Gothic", Arial, sans-serif; background: #f7f7f4; color: #171717; overflow-x: hidden; }
    main { width: min(1180px, calc(100vw - 32px)); margin: 28px auto; display: grid; gap: 18px; }
    section, .topbar { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 20px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    h1, h2 { margin: 0; line-height: 1.2; }
    h1 { font-size: 28px; }
    h2 { font-size: 26px; margin-bottom: 18px; }
    .form-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 1fr); gap: 12px; align-items: stretch; }
    .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .wide { grid-column: 1 / -1; }
    input, select, textarea, button { width: 100%; min-width: 0; font: inherit; padding: 11px 12px; border: 1px solid #ccc; border-radius: 6px; background: #fff; }
    textarea { min-height: 82px; resize: vertical; }
    button { border: 0; background: #1f5f8b; color: white; cursor: pointer; font-weight: 700; }
    button.secondary { background: #555; }
    button.danger { background: #9f2727; padding: 8px 10px; }
    .latest-badge { display: inline-block; border-radius: 999px; padding: 4px 8px; background: #edf7ef; color: #146c2e; font-size: 13px; font-weight: 700; }
    .help { margin: 4px 0 0; line-height: 1.6; color: #333; }
    pre { white-space: pre-wrap; background: #f2f4f5; padding: 12px; border-radius: 6px; margin: 0; max-height: 220px; overflow: auto; }
    .table-wrap { overflow-x: auto; border: 1px solid #e5e5e5; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
    th { background: #f2f4f5; font-weight: 700; }
    tr:last-child td { border-bottom: 0; }
    .mono { font-family: Consolas, monospace; font-size: 13px; word-break: break-all; }
    .empty { padding: 16px; color: #666; background: #f2f4f5; border-radius: 6px; }
    @media (max-width: 760px) {
      main { width: min(100vw - 20px, 1180px); margin: 10px auto; gap: 12px; }
      section, .topbar { padding: 14px; }
      .topbar { align-items: stretch; flex-direction: column; }
      .form-grid, .actions { grid-template-columns: 1fr; }
      .wide { grid-column: auto; }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>Litire ?쇱씠?좎뒪 / ?낅뜲?댄듃 愿由?/h1>
      <button class="secondary" style="width:auto" onclick="logout()">濡쒓렇?꾩썐</button>
    </div>

    <section>
      <h2>?쇱씠?좎뒪 諛쒓툒</h2>
      <div class="form-grid">
        <input id="email" placeholder="?꾩씠???먮뒗 ?대찓?? />
        <select id="status"><option value="active">active</option><option value="trial">trial</option><option value="suspended">suspended</option></select>
        <input id="seats" type="number" value="1" min="1" />
        <input id="expiresAt" type="datetime-local" />
        <input id="memo" class="wide" placeholder="硫붾え" />
        <div class="actions wide">
          <button onclick="createLicense()">諛쒓툒</button>
          <button onclick="listLicenses()">?쇱씠?좎뒪 紐⑸줉</button>
        </div>
      </div>
    </section>

    <section>
      <h2>?낅뜲?댄듃 ?깅줉</h2>
      <div class="form-grid">
        <input id="version" placeholder="踰꾩쟾 ?? 1.69.0, ?뚯씪紐낆뿉??媛먯??섎㈃ ?앸왂 媛?? />
        <input id="zipFile" type="file" accept=".zip,application/zip" />
        <input id="channel" value="stable" />
        <select id="isRequired"><option value="">?좏깮 ?낅뜲?댄듃</option><option value="true">?꾩닔 ?낅뜲?댄듃</option></select>
        <textarea id="notes" class="wide" placeholder="?낅뜲?댄듃 ?댁슜"></textarea>
        <p class="help wide">Tauri 鍮뚮뱶 寃곌낵 zip ?덉뿉 ?ㅼ튂 ?뚯씪(.exe ?먮뒗 .msi)怨?媛숈? ?대쫫??.sig ?뚯씪???④퍡 ?ｌ뼱 ?낅줈?쒗븯?몄슂. ?쒕쾭媛 ?ㅼ튂 ?뚯씪, ?쒕챸, 踰꾩쟾???먮룞 異붿텧?⑸땲??</p>
        <div class="actions wide">
          <button onclick="createRelease()">zip ?낅줈???깅줉</button>
          <button onclick="listReleases()">?낅뜲?댄듃 紐⑸줉 ?덈줈怨좎묠</button>
        </div>
      </div>
    </section>

    <section>
      <h2>?낅뜲?댄듃 紐⑸줉</h2>
      <div id="releaseList" class="empty">?낅줈?쒗븯硫??먮룞?쇰줈 紐⑸줉???쒖떆?⑸땲??</div>
    </section>

    <section>
      <h2>寃곌낵</h2>
      <pre id="out">?湲?以?/pre>
    </section>
  </main>
  <script>
    const out = document.getElementById('out');
    const releaseList = document.getElementById('releaseList');

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('?쒕쾭媛 JSON???꾨땶 ?묐떟??蹂대깉?듬땲?? HTTP ' + response.status + ': ' + text.slice(0, 300));
      }
      if (!response.ok) {
        out.textContent = JSON.stringify(data, null, 2);
        throw new Error(data.message || ('HTTP ' + response.status));
      }
      return data;
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]);
    }

    function isoFromLocal(value) { return value ? new Date(value).toISOString() : null; }

    async function logout() {
      await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' });
      location.href = '/admin';
    }

    async function createLicense() {
      try {
        const data = await api('/admin/licenses', { method: 'POST', body: JSON.stringify({
          email: document.getElementById('email').value,
          status: document.getElementById('status').value,
          seats: Number(document.getElementById('seats').value || 1),
          expiresAt: isoFromLocal(document.getElementById('expiresAt').value),
          memo: document.getElementById('memo').value
        })});
        out.textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        out.textContent = '?ㅽ뙣: ' + (error && error.message ? error.message : String(error));
      }
    }

    async function listLicenses() {
      try {
        const data = await api('/admin/licenses');
        out.textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        out.textContent = '?ㅽ뙣: ' + (error && error.message ? error.message : String(error));
      }
    }

    async function uploadZipRelease(zipFile) {
      const params = new URLSearchParams({
        version: document.getElementById('version').value,
        fileName: zipFile.name,
        channel: document.getElementById('channel').value || 'stable',
        isRequired: String(document.getElementById('isRequired').value === 'true'),
        notes: document.getElementById('notes').value,
      });
      const response = await fetch('/admin/releases?' + params.toString(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/zip' },
        body: zipFile,
      });
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('?쒕쾭媛 JSON???꾨땶 ?묐떟??蹂대깉?듬땲?? HTTP ' + response.status + ': ' + text.slice(0, 300));
      }
      if (!response.ok) throw new Error(data.message || ('HTTP ' + response.status));
      return data;
    }

    async function createRelease() {
      const zipFile = document.getElementById('zipFile').files[0];
      if (!zipFile) {
        out.textContent = '\uc5c5\ub370\uc774\ud2b8 zip \ud30c\uc77c\uc744 \uc120\ud0dd\ud574 \uc8fc\uc138\uc694.';
        return;
      }
      out.textContent = 'zip \ud30c\uc77c\uc744 \uc11c\ubc84\ub85c \uc5c5\ub85c\ub4dc\ud558\ub294 \uc911\uc785\ub2c8\ub2e4. \ud30c\uc77c \ud06c\uae30: ' + Math.round(zipFile.size / 1024 / 1024 * 10) / 10 + 'MB';
      try {
        const data = await uploadZipRelease(zipFile);
        out.textContent = '\uc5c5\ub85c\ub4dc \uc644\ub8cc: ' + data.release.version + ' / ' + data.release.fileName;
        await listReleases();
        alert('\uc5c5\ub370\uc774\ud2b8 \ub4f1\ub85d\uc774 \uc644\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
      } catch (error) {
        out.textContent = '\uc5c5\ub85c\ub4dc \uc2e4\ud328: ' + (error && error.message ? error.message : String(error));
      }
    }

    async function deleteRelease(releaseId, fileName, canDelete) {
      if (!canDelete) return;
      const ok = confirm(fileName + '\n\n\uc774 \uc5c5\ub370\uc774\ud2b8\ub97c \ubaa9\ub85d\uacfc \uc11c\ubc84 \ud30c\uc77c\uc5d0\uc11c \uc0ad\uc81c\ud560\uae4c\uc694?');
      if (!ok) return;
      try {
        const data = await api('/admin/releases/' + encodeURIComponent(releaseId), { method: 'DELETE' });
        renderReleases(data.releases);
        out.textContent = data.fileDeleted ? '\uc0ad\uc81c \uc644\ub8cc: \ubaa9\ub85d\uacfc \uc2e4\uc81c \ud30c\uc77c\uc744 \uc0ad\uc81c\ud588\uc2b5\ub2c8\ub2e4.' : '\uc0ad\uc81c \uc644\ub8cc: \ubaa9\ub85d\uc744 \uc0ad\uc81c\ud588\uc2b5\ub2c8\ub2e4. \ub3d9\uc77c \ud30c\uc77c\uc744 \ucc38\uc870\ud558\ub294 \ub2e4\ub978 \ud56d\ubaa9\uc774 \uc788\uc5b4 \ud30c\uc77c\uc740 \uc720\uc9c0\ud588\uc2b5\ub2c8\ub2e4.';
        alert('\uc0ad\uc81c\uac00 \uc644\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
      } catch (error) {
        out.textContent = '\uc0ad\uc81c \uc2e4\ud328: ' + (error && error.message ? error.message : String(error));
      }
    }

    releaseList.addEventListener('click', (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest('button[data-release-id]') : null;
      if (!button) return;
      deleteRelease(button.dataset.releaseId || '', button.dataset.fileName || '', true);
    });

    function renderReleases(releases) {
      if (!Array.isArray(releases) || releases.length === 0) {
        releaseList.className = 'empty';
        releaseList.textContent = '\ub4f1\ub85d\ub41c \uc5c5\ub370\uc774\ud2b8\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.';
        return;
      }
      releaseList.className = 'table-wrap';
      releaseList.innerHTML = '<table><thead><tr><th>\ubc84\uc804</th><th>\ucc44\ub110</th><th>\ud30c\uc77c</th><th>\ud544\uc218</th><th>\ub4f1\ub85d\uc77c</th><th>\uba54\ubaa8</th><th>\uad00\ub9ac</th></tr></thead><tbody>' +
        releases.map((release, index) => {
          const canDelete = index > 0;
          return '<tr>' +
            '<td class="mono">' + escapeHtml(release.version) + (index === 0 ? '<br><span class="latest-badge">\ucd5c\uc2e0</span>' : '') + '</td>' +
            '<td>' + escapeHtml(release.channel) + '</td>' +
            '<td class="mono">' + escapeHtml(release.fileName) + '</td>' +
            '<td>' + (release.isRequired ? '\uc608' : '\uc544\ub2c8\uc624') + '</td>' +
            '<td class="mono">' + escapeHtml(release.createdAt || '') + '</td>' +
            '<td>' + escapeHtml(release.notes || '') + '</td>' +
          '<td>' + (canDelete ? '<button class="danger" data-release-id="' + escapeHtml(release.id) + '" data-file-name="' + escapeHtml(release.fileName) + '">\uc0ad\uc81c</button>' : '<span class="latest-badge">\uc720\uc9c0</span>') + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table>';
    }

    async function listReleases() {
      try {
        const data = await api('/admin/releases');
        renderReleases(data.releases);
      } catch (error) {
        out.textContent = '紐⑸줉 議고쉶 ?ㅽ뙣: ' + (error && error.message ? error.message : String(error));
      }
    }

    void listReleases();
  </script>
</body>
</html>`
}
function renderAdminLogin(message = '') {
  const safeMessage = escapeHtml(message)
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Litire Admin Login</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: "Malgun Gothic", sans-serif; background: #f7f7f4; color: #171717; }
    .panel { width: min(420px, calc(100vw - 32px)); background: white; border: 1px solid #ddd; border-radius: 10px; padding: 28px; box-sizing: border-box; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    p { margin: 0 0 20px; color: #666; }
    input, button { width: 100%; box-sizing: border-box; font: inherit; padding: 12px; border-radius: 6px; }
    input { border: 1px solid #ccc; margin-bottom: 12px; }
    button { border: 0; background: #1f5f8b; color: white; cursor: pointer; }
    pre { white-space: pre-wrap; background: #f2f4f5; padding: 12px; border-radius: 6px; margin-top: 16px; color: #9a3412; }
  </style>
</head>
<body>
  <form class="panel" method="post" action="/admin/login">
    <h1>?온?귐딆쁽 嚥≪뮄???/h1>
    <p>?온?귐딆쁽 ?醫뤾쿃??곗쨮 嚥≪뮄??紐낅립 ????낅쑓??꾨뱜???源낆쨯??몃빍??</p>
    <input name="adminToken" type="password" placeholder="?온?귐딆쁽 ?醫뤾쿃" autofocus autocomplete="current-password" />
    <button type="submit">嚥≪뮄???/button>
    ${safeMessage ? `<pre>${safeMessage}</pre>` : ''}
  </form>
</body>
</html>`
}

function renderAdminLoginPageFixed(message = '') {
  const safeMessage = escapeHtml(message)
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Litire admin login</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: "Malgun Gothic", Arial, sans-serif; background: #f7f7f4; color: #171717; }
    .panel { width: min(440px, calc(100vw - 32px)); background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 28px; box-shadow: 0 12px 30px rgba(0,0,0,.05); }
    h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.2; }
    p { margin: 0 0 20px; color: #666; line-height: 1.5; }
    input, button { width: 100%; font: inherit; padding: 12px; border-radius: 6px; }
    input { border: 1px solid #ccc; margin-bottom: 12px; }
    button { border: 0; background: #1f5f8b; color: white; cursor: pointer; font-weight: 700; }
    .version { margin-top: 14px; font-size: 13px; color: #777; }
    pre { white-space: pre-wrap; background: #f2f4f5; padding: 12px; border-radius: 6px; margin: 16px 0 0; color: #9a3412; }
  </style>
</head>
<body>
  <form class="panel" method="post" action="/admin/login">
    <h1>&#44288;&#47532;&#51088; &#47196;&#44536;&#51064;</h1>
    <p>&#44288;&#47532;&#51088; &#53664;&#53360;&#51004;&#47196; &#47196;&#44536;&#51064;&#54620; &#46244; &#46972;&#51060;&#49468;&#49828;&#50752; &#50629;&#45936;&#51060;&#53944;&#47484; &#44288;&#47532;&#54633;&#45768;&#45796;.</p>
    <input name="adminToken" type="password" placeholder="&#44288;&#47532;&#51088; &#53664;&#53360;" autofocus autocomplete="current-password" />
    <button type="submit">&#47196;&#44536;&#51064;</button>
    <div class="version">Server version ${SERVER_VERSION}</div>
    ${safeMessage ? `<pre>${safeMessage}</pre>` : ''}
  </form>
</body>
</html>`
}

function renderAdminPageFixed() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Litire admin</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Malgun Gothic", Arial, sans-serif; background: #f7f7f4; color: #171717; overflow-x: hidden; }
    main { width: min(1180px, calc(100vw - 32px)); margin: 28px auto; display: grid; gap: 18px; }
    section, .topbar { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 20px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    h1, h2 { margin: 0; line-height: 1.2; }
    h1 { font-size: 28px; }
    h2 { font-size: 26px; margin-bottom: 18px; }
    .version { color: #666; font-size: 14px; margin-top: 6px; }
    .form-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 1fr); gap: 12px; align-items: stretch; }
    .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .wide { grid-column: 1 / -1; }
    input, select, textarea, button { width: 100%; min-width: 0; font: inherit; padding: 11px 12px; border: 1px solid #ccc; border-radius: 6px; background: #fff; }
    textarea { min-height: 82px; resize: vertical; }
    button { border: 0; background: #1f5f8b; color: white; cursor: pointer; font-weight: 700; }
    button.secondary { background: #555; }
    button.danger { background: #9f2727; padding: 8px 10px; }
    button:disabled { opacity: .58; cursor: not-allowed; }
    .help { margin: 4px 0 0; line-height: 1.6; color: #333; }
    pre { white-space: pre-wrap; background: #f2f4f5; padding: 12px; border-radius: 6px; margin: 0; max-height: 220px; overflow: auto; }
    .table-wrap { overflow-x: auto; border: 1px solid #e5e5e5; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; min-width: 920px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
    th { background: #f2f4f5; font-weight: 700; }
    tr:last-child td { border-bottom: 0; }
    .mono { font-family: Consolas, monospace; font-size: 13px; word-break: break-all; }
    .empty { padding: 16px; color: #666; background: #f2f4f5; border-radius: 6px; }
    .latest-badge { display: inline-block; border-radius: 999px; padding: 4px 8px; background: #edf7ef; color: #146c2e; font-size: 13px; font-weight: 700; }
    @media (max-width: 760px) { main { width: min(100vw - 20px, 1180px); margin: 10px auto; gap: 12px; } section, .topbar { padding: 14px; } .topbar { align-items: stretch; flex-direction: column; } .form-grid, .actions { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
  </style>
</head>
<body>
  <main>
    <div class="topbar"><div><h1>Litire &#46972;&#51060;&#49468;&#49828; / &#50629;&#45936;&#51060;&#53944; &#44288;&#47532;</h1><div class="version">Server version ${SERVER_VERSION}</div></div><button class="secondary" style="width:auto" onclick="logout()">&#47196;&#44536;&#50500;&#50883;</button></div>
    <section><h2>&#46972;&#51060;&#49468;&#49828; &#48156;&#44553;</h2><div class="form-grid"><input id="email" placeholder="&#50500;&#51060;&#46356; &#46608;&#45716; &#51060;&#47700;&#51068;" /><select id="status"><option value="active">active</option><option value="trial">trial</option><option value="suspended">suspended</option></select><input id="seats" type="number" value="1" min="1" /><input id="expiresAt" type="datetime-local" /><input id="memo" class="wide" placeholder="&#47700;&#47784;" /><div class="actions wide"><button id="licenseButton" onclick="createLicense()">&#48156;&#44553;</button><button onclick="listLicenses()">&#46972;&#51060;&#49468;&#49828; &#47785;&#47197; &#49352;&#47196;&#44256;&#52840;</button></div></div></section>
    <section><h2>&#46972;&#51060;&#49468;&#49828; &#47785;&#47197;</h2><div id="licenseList" class="empty">&#48156;&#44553;&#54616;&#47732; &#51088;&#46041;&#51004;&#47196; &#47785;&#47197;&#51060; &#54364;&#49884;&#46121;&#45768;&#45796;.</div></section>
    <section><h2>&#50629;&#45936;&#51060;&#53944; &#46321;&#47197;</h2><div class="form-grid"><input id="version" placeholder="&#48260;&#51204; &#50696;: ${SERVER_VERSION}, &#54028;&#51068;&#47749;&#50640;&#49436; &#44048;&#51648;&#46104;&#47732; &#49373;&#47029; &#44032;&#45733;" /><input id="zipFile" type="file" accept=".zip,application/zip" /><input id="channel" value="stable" /><select id="isRequired"><option value="">&#49440;&#53469; &#50629;&#45936;&#51060;&#53944;</option><option value="true">&#54596;&#49688; &#50629;&#45936;&#51060;&#53944;</option></select><textarea id="notes" class="wide" placeholder="&#50629;&#45936;&#51060;&#53944; &#45236;&#50857;"></textarea><p class="help wide">Tauri &#48716;&#46300; &#44208;&#44284; zip &#50504;&#50640; &#49444;&#52824; &#54028;&#51068;(.exe &#46608;&#45716; .msi)&#44284; &#44057;&#51008; &#51060;&#47492;&#51032; .sig &#54028;&#51068;&#51012; &#54632;&#44760; &#45347;&#50612; &#50629;&#47196;&#46300;&#54616;&#49464;&#50836;. &#49436;&#48260;&#44032; &#49444;&#52824; &#54028;&#51068;, &#49436;&#47749;, &#48260;&#51204;&#51012; &#51088;&#46041; &#52628;&#52636;&#54633;&#45768;&#45796;.</p><div class="actions wide"><button id="uploadButton" onclick="createRelease()">zip &#50629;&#47196;&#46300; &#46321;&#47197;</button><button onclick="listReleases()">&#50629;&#45936;&#51060;&#53944; &#47785;&#47197; &#49352;&#47196;&#44256;&#52840;</button></div></div></section>
    <section><h2>&#50629;&#45936;&#51060;&#53944; &#47785;&#47197;</h2><div id="releaseList" class="empty">&#50629;&#47196;&#46300;&#54616;&#47732; &#51088;&#46041;&#51004;&#47196; &#47785;&#47197;&#51060; &#54364;&#49884;&#46121;&#45768;&#45796;.</div></section>
    <section><h2>&#44208;&#44284;</h2><pre id="out">&#45824;&#44592; &#51473;</pre></section>
  </main>
  <script>
    const out = document.getElementById('out');
    const licenseList = document.getElementById('licenseList');
    const releaseList = document.getElementById('releaseList');
    const licenseButton = document.getElementById('licenseButton');
    const uploadButton = document.getElementById('uploadButton');
    async function api(path, options = {}) { const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let data; try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('JSON response expected. HTTP ' + response.status + ': ' + text.slice(0, 300)); } if (!response.ok) { out.textContent = JSON.stringify(data, null, 2); throw new Error(data.message || ('HTTP ' + response.status)); } return data; }
    function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
    function isoFromLocal(value) { return value ? new Date(value).toISOString() : null; }
    async function logout() { await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' }); location.href = '/admin'; }
    function formatDate(value) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return String(value); return date.toLocaleString('ko-KR', { hour12: false }); }
    async function createLicense() { licenseButton.disabled = true; out.textContent = '\uB77C\uC774\uC120\uC2A4\uB97C \uBC1C\uAE09\uD558\uB294 \uC911\uC785\uB2C8\uB2E4.'; try { const data = await api('/admin/licenses', { method: 'POST', body: JSON.stringify({ email: document.getElementById('email').value, status: document.getElementById('status').value, seats: Number(document.getElementById('seats').value || 1), expiresAt: isoFromLocal(document.getElementById('expiresAt').value), memo: document.getElementById('memo').value }) }); out.textContent = '\uBC1C\uAE09 \uC644\uB8CC: ' + data.license.email + ' / ' + data.license.licenseKey; await listLicenses(); alert('\uB77C\uC774\uC120\uC2A4\uAC00 \uBC1C\uAE09\uB418\uC5C8\uC2B5\uB2C8\uB2E4.'); } catch (error) { out.textContent = '\uBC1C\uAE09 \uC2E4\uD328: ' + (error && error.message ? error.message : String(error)); } finally { licenseButton.disabled = false; } }
    function renderLicenses(licenses, devices) { if (!Array.isArray(licenses) || licenses.length === 0) { licenseList.className = 'empty'; licenseList.textContent = '\uBC1C\uAE09\uB41C \uB77C\uC774\uC120\uC2A4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'; return; } const activeDevices = Array.isArray(devices) ? devices.filter((device) => device.isActive !== false) : []; licenseList.className = 'table-wrap'; licenseList.innerHTML = '<table><thead><tr><th>\uC544\uC774\uB514 / \uC774\uBA54\uC77C</th><th>\uB77C\uC774\uC120\uC2A4 \uD0A4</th><th>\uC0C1\uD0DC</th><th>\uC88C\uC11D</th><th>\uD65C\uC131 \uAE30\uAE30</th><th>\uB9CC\uB8CC\uC77C</th><th>\uBC1C\uAE09\uC77C</th><th>\uBA54\uBAA8</th></tr></thead><tbody>' + licenses.map((license) => { const activeDeviceCount = activeDevices.filter((device) => device.licenseKey === license.licenseKey).length; return '<tr>' + '<td>' + escapeHtml(license.email) + '</td>' + '<td class="mono">' + escapeHtml(license.licenseKey) + '</td>' + '<td>' + escapeHtml(license.status || '') + '</td>' + '<td>' + escapeHtml(license.seats || 1) + '</td>' + '<td>' + activeDeviceCount + '</td>' + '<td class="mono">' + escapeHtml(formatDate(license.expiresAt)) + '</td>' + '<td class="mono">' + escapeHtml(formatDate(license.createdAt)) + '</td>' + '<td>' + escapeHtml(license.memo || '') + '</td>' + '</tr>'; }).join('') + '</tbody></table>'; }
    async function listLicenses() { try { const data = await api('/admin/licenses'); renderLicenses(data.licenses, data.devices); } catch (error) { out.textContent = '\uB77C\uC774\uC120\uC2A4 \uBAA9\uB85D \uC870\uD68C \uC2E4\uD328: ' + (error && error.message ? error.message : String(error)); } }
    async function uploadZipRelease(zipFile) { const params = new URLSearchParams({ version: document.getElementById('version').value, fileName: zipFile.name, channel: document.getElementById('channel').value || 'stable', isRequired: String(document.getElementById('isRequired').value === 'true'), notes: document.getElementById('notes').value }); const response = await fetch('/admin/releases?' + params.toString(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/zip' }, body: zipFile }); const text = await response.text(); let data; try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('JSON response expected. HTTP ' + response.status + ': ' + text.slice(0, 300)); } if (!response.ok) throw new Error(data.message || ('HTTP ' + response.status)); return data; }
    async function createRelease() { const zipFile = document.getElementById('zipFile').files[0]; if (!zipFile) { out.textContent = '\uC5C5\uB370\uC774\uD2B8 zip \uD30C\uC77C\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.'; return; } uploadButton.disabled = true; out.textContent = 'zip \uD30C\uC77C\uC744 \uC77D\uACE0 \uC5C5\uB85C\uB4DC\uD558\uB294 \uC911\uC785\uB2C8\uB2E4. \uD30C\uC77C \uD06C\uAE30: ' + Math.round(zipFile.size / 1024 / 1024 * 10) / 10 + 'MB'; try { const data = await uploadZipRelease(zipFile); out.textContent = '\uC5C5\uB85C\uB4DC \uC644\uB8CC: ' + data.release.version + ' / ' + data.release.fileName; await listReleases(); alert('\uC5C5\uB85C\uB4DC\uAC00 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.'); } catch (error) { out.textContent = '\uC5C5\uB85C\uB4DC \uC2E4\uD328: ' + (error && error.message ? error.message : String(error)); } finally { uploadButton.disabled = false; } }
    async function deleteRelease(releaseId, fileName, canDelete) { if (!canDelete) return; if (!confirm(fileName + '\\n\\n\uC774 \uC5C5\uB370\uC774\uD2B8 \uBAA9\uB85D\uACFC \uC2E4\uC81C \uD30C\uC77C\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?')) return; try { const data = await api('/admin/releases/' + encodeURIComponent(releaseId), { method: 'DELETE' }); renderReleases(data.releases); out.textContent = data.fileDeleted ? '\uC0AD\uC81C \uC644\uB8CC: \uBAA9\uB85D\uACFC \uD30C\uC77C\uC744 \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4.' : '\uC0AD\uC81C \uC644\uB8CC: \uBAA9\uB85D\uC744 \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uD30C\uC77C\uC744 \uC4F0\uB294 \uB2E4\uB978 \uBAA9\uB85D\uC774 \uC788\uC5B4 \uD30C\uC77C\uC740 \uC720\uC9C0\uD588\uC2B5\uB2C8\uB2E4.'; alert('\uC0AD\uC81C\uAC00 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.'); } catch (error) { out.textContent = '\uC0AD\uC81C \uC2E4\uD328: ' + (error && error.message ? error.message : String(error)); } }
    releaseList.addEventListener('click', (event) => { const button = event.target instanceof HTMLElement ? event.target.closest('button[data-release-id]') : null; if (!button) return; deleteRelease(button.dataset.releaseId || '', button.dataset.fileName || '', true); });
    function renderReleases(releases) { if (!Array.isArray(releases) || releases.length === 0) { releaseList.className = 'empty'; releaseList.textContent = '\uB4F1\uB85D\uB41C \uC5C5\uB370\uC774\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'; return; } releaseList.className = 'table-wrap'; releaseList.innerHTML = '<table><thead><tr><th>\uBC84\uC804</th><th>\uCC44\uB110</th><th>\uD30C\uC77C</th><th>\uD544\uC218</th><th>\uB4F1\uB85D\uC77C</th><th>\uBA54\uBAA8</th><th>\uAD00\uB9AC</th></tr></thead><tbody>' + releases.map((release, index) => { const canDelete = index > 0; return '<tr>' + '<td class="mono">' + escapeHtml(release.version) + (index === 0 ? '<br><span class="latest-badge">\uCD5C\uC2E0</span>' : '') + '</td>' + '<td>' + escapeHtml(release.channel) + '</td>' + '<td class="mono">' + escapeHtml(release.fileName) + '</td>' + '<td>' + (release.isRequired ? '\uC608' : '\uC544\uB2C8\uC624') + '</td>' + '<td class="mono">' + escapeHtml(release.createdAt || '') + '</td>' + '<td>' + escapeHtml(release.notes || '') + '</td>' + '<td>' + (canDelete ? '<button class="danger" data-release-id="' + escapeHtml(release.id) + '" data-file-name="' + escapeHtml(release.fileName) + '">\uC0AD\uC81C</button>' : '<span class="latest-badge">\uC720\uC9C0</span>') + '</td>' + '</tr>'; }).join('') + '</tbody></table>'; }
    async function listReleases() { try { const data = await api('/admin/releases'); renderReleases(data.releases); } catch (error) { out.textContent = '\uBAA9\uB85D \uC870\uD68C \uC2E4\uD328: ' + (error && error.message ? error.message : String(error)); } }
    void listLicenses();
    void listReleases();
  </script>
</body>
</html>`
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
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .logout { width: auto; padding: 8px 12px; background: #555; }
    input, select, textarea, button { font: inherit; padding: 10px; border: 1px solid #ccc; border-radius: 6px; }
    button { background: #1f5f8b; color: white; border: 0; cursor: pointer; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .wide { grid-column: 1 / -1; }
    pre { white-space: pre-wrap; background: #f2f4f5; padding: 12px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>Litire ??깆뵠?醫롫뮞 / ??낅쑓??꾨뱜 ?온??/h1>
      <button class="logout" onclick="logout()">嚥≪뮄??袁⑹뜍</button>
    </div>
    <section>
      <h2>??깆뵠?醫롫뮞 獄쏆뮄??/h2>
      <div class="grid">
        <input id="token" placeholder="?온?귐딆쁽 ?醫뤾쿃" />
        <input id="email" placeholder="?袁⑹뵠???癒?뮉 ??李?? />
        <select id="status"><option value="active">active</option><option value="trial">trial</option><option value="suspended">suspended</option></select>
        <input id="seats" type="number" value="1" min="1" />
        <input id="expiresAt" type="datetime-local" />
        <input id="memo" placeholder="筌롫뗀?? />
        <button onclick="createLicense()">獄쏆뮄??/button>
        <button onclick="listLicenses()">筌뤴뫖以?癰귣떯由?/button>
      </div>
    </section>
    <section>
      <h2>??낅쑓??꾨뱜 ?源낆쨯</h2>
      <div class="grid">
        <input id="version" placeholder="甕곌쑴???? 1.6.2, zip ???뵬筌뤿굞肉???癒?짗 揶쏅Ŋ???롢늺 ??몄셽 揶쎛?? />
        <input id="zipFile" type="file" accept=".zip,application/zip" />
        <input id="channel" value="stable" />
        <select id="isRequired"><option value="">?醫뤾문 ??낅쑓??꾨뱜</option><option value="true">?袁⑸땾 ??낅쑓??꾨뱜</option></select>
        <textarea id="notes" class="wide" placeholder="??낅쑓??꾨뱜 ??곸뒠"></textarea>
        <p class="wide">Tauri ??슢諭?野껉퀗??zip ??됰퓠 ??쇳뒄 ???뵬(.exe ?癒?뮉 .msi)??揶쏆늿? ??已??.sig ???뵬????ｍ뜞 ?節뚮선 ??낆쨮??쀫릭?紐꾩뒄. ??뺤쒔揶쎛 ??쇳뒄 ???뵬, ??뺤구, 甕곌쑴????癒?짗??곗쨮 ?곕뗄???몃빍??</p>
        <button onclick="createRelease()">zip ??낆쨮???源낆쨯</button>
        <button onclick="listReleases()">??낅쑓??꾨뱜 筌뤴뫖以?/button>
      </div>
    </section>
    <section><h2>野껉퀗??/h2><pre id="out"></pre></section>
  </main>
  <script>
    const out = document.getElementById('out');
    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('??뺤쒔揶쎛 JSON???袁⑤빒 ?臾먮뼗??癰귣?源??щ빍?? HTTP ' + response.status + ': ' + text.slice(0, 300));
      }
      out.textContent = JSON.stringify(data, null, 2);
      if (!response.ok) {
        throw new Error(data.message || ('HTTP ' + response.status));
      }
      return data;
    }
    async function logout() {
      await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' });
      location.href = '/admin';
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
    async function uploadZipRelease(zipFile) {
      const params = new URLSearchParams({
        version: document.getElementById('version').value,
        fileName: zipFile.name,
        channel: document.getElementById('channel').value || 'stable',
        isRequired: String(document.getElementById('isRequired').value === 'true'),
        notes: document.getElementById('notes').value,
      });
      const response = await fetch('/admin/releases?' + params.toString(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/zip' },
        body: zipFile,
      });
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('??뺤쒔揶쎛 JSON???袁⑤빒 ?臾먮뼗??癰귣?源??щ빍?? HTTP ' + response.status + ': ' + text.slice(0, 300));
      }
      out.textContent = JSON.stringify(data, null, 2);
      if (!response.ok) {
        throw new Error(data.message || ('HTTP ' + response.status));
      }
      return data;
    }
    async function createRelease() {
      const zipFile = document.getElementById('zipFile').files[0];
      if (!zipFile) {
        out.textContent = '??낅쑓??꾨뱜 zip ???뵬???醫뤾문??雅뚯눘苑??';
        return;
      }
      out.textContent = 'zip ???뵬????뺤쒔嚥???낆쨮??쀫릭??餓λ쵐???덈뼄. ???뵬 ??由? ' + Math.round(zipFile.size / 1024 / 1024 * 10) / 10 + 'MB';
      try {
        await uploadZipRelease(zipFile);
      } catch (error) {
        out.textContent = '??낆쨮????쎈솭: ' + (error && error.message ? error.message : String(error));
      }
    }
    async function listReleases() { await api('/admin/releases'); }
  </script>
</body>
</html>`
}

async function handleAdminLogin(request, response) {
  const rawBody = await readRawBody(request)
  const contentType = String(request.headers['content-type'] || '').toLowerCase()
  const wantsJson = contentType.includes('application/json') || String(request.headers.accept || '').includes('application/json')
  let adminToken = ''
  if (contentType.includes('application/json')) {
    try {
      adminToken = String(JSON.parse(rawBody.toString('utf8')).adminToken || '')
    } catch {
      adminToken = ''
    }
  } else {
    adminToken = String(new URLSearchParams(rawBody.toString('utf8')).get('adminToken') || '')
  }

  if (adminToken !== ADMIN_TOKEN) {
    if (wantsJson) {
      sendJson(response, 401, { ok: false, message: '愿由ъ옄 ?좏겙???щ컮瑜댁? ?딆뒿?덈떎.' })
      return
    }
    sendHtml(response, 401, renderAdminLoginPageFixed('愿由ъ옄 ?좏겙???щ컮瑜댁? ?딆뒿?덈떎.'))
    return
  }

  const sessionToken = signAdminSession()
  setAdminSessionCookie(response, sessionToken)
  if (wantsJson) {
    sendJson(response, 200, { ok: true, sessionToken, expiresInSeconds: Math.floor(ADMIN_SESSION_TTL_MS / 1000) })
    return
  }
  sendRedirect(response, '/admin')
}
async function handleLicenseActivate(request, response) {
  const body = await readBody(request)
  const email = normalizeEmail(body.email)
  const licenseKey = String(body.licenseKey || '').trim()
  const deviceId = String(body.deviceId || '').trim()
  const deviceName = String(body.deviceName || '').trim()
  if (!email || !licenseKey || !deviceId) {
    sendJson(response, 400, { ok: false, message: '\uC544\uC774\uB514, \uB77C\uC774\uC120\uC2A4 \uD0A4, \uAE30\uAE30 ID\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.' })
    return
  }

  const data = await readData()
  const license = findLicense(data, email, licenseKey)
  if (!license) {
    sendJson(response, 403, { ok: false, status: 'not_found', message: '\uB77C\uC774\uC120\uC2A4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.' })
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
    const limitState = { ok: false, status: 'device_limit', message: '????揶쎛?館釉?疫꿸퀗由???? ?λ뜃???됰뮸??덈뼄.' }
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
    sendJson(response, 403, { ok: false, status: 'not_found', message: '\uB77C\uC774\uC120\uC2A4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.' })
    return
  }
  const device = data.devices.find(
    (entry) => entry.licenseKey === license.licenseKey && entry.deviceId === deviceId && entry.isActive !== false,
  )
  if (!device) {
    sendJson(response, 403, toLicenseResponse(license, { ok: false, status: 'not_activated', message: '\uC774 \uAE30\uAE30\uC5D0\uC11C \uD65C\uC131\uD654\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.' }, deviceId))
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
    sendJson(response, 400, { ok: false, message: '\uC544\uC774\uB514 \uB610\uB294 \uC774\uBA54\uC77C\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.' })
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

function prepareUpdateUpload(fileName, fileBase64) {
  if (!fileName.toLowerCase().endsWith('.zip')) {
    throw new Error('\uC5C5\uB370\uC774\uD2B8\uB294 \uC11C\uBC84 \uC5C5\uB85C\uB4DC\uC6A9 zip \uD30C\uC77C\uB85C \uC62C\uB824 \uC8FC\uC138\uC694.')
  }
  const [, payload = fileBase64] = String(fileBase64 || '').split(',')
  const extracted = extractUpdateReleaseFromZip(Buffer.from(payload, 'base64'))
  return {
    fileName: extracted.fileName,
    fileBytes: extracted.fileBytes,
    signature: extracted.signature,
    version: extracted.version,
  }
}

function prepareUpdateUploadFromZipBuffer(fileName, zipBuffer) {
  if (!fileName.toLowerCase().endsWith('.zip')) {
    throw new Error('\uC5C5\uB370\uC774\uD2B8\uB294 \uC11C\uBC84 \uC5C5\uB85C\uB4DC\uC6A9 zip \uD30C\uC77C\uB85C \uC62C\uB824 \uC8FC\uC138\uC694.')
  }
  const extracted = extractUpdateReleaseFromZip(zipBuffer)
  return {
    fileName: extracted.fileName,
    fileBytes: extracted.fileBytes,
    signature: extracted.signature,
    version: extracted.version,
  }
}

async function handleCreateRelease(request, response) {
  const url = new URL(request.url || '/', PUBLIC_BASE_URL)
  const contentType = String(request.headers['content-type'] || '').toLowerCase()
  const fileNameParam = path.basename(String(url.searchParams.get('fileName') || ''))
  const isZipUpload =
    contentType.includes('application/zip') ||
    contentType.includes('application/octet-stream') ||
    contentType.includes('application/x-zip-compressed') ||
    (!contentType.includes('json') && fileNameParam.toLowerCase().endsWith('.zip'))
  console.log(
    `[release-upload] start contentType=${contentType || '-'} contentLength=${request.headers['content-length'] || '-'} fileName=${fileNameParam || '-'}`,
  )
  const zipBuffer = isZipUpload ? await readRawBody(request) : null
  if (zipBuffer) {
    console.log(`[release-upload] received zip bytes=${zipBuffer.length}`)
  }
  const body = isZipUpload
    ? {
        version: url.searchParams.get('version') || '',
        fileName: fileNameParam,
        channel: normalizeChannel(url.searchParams.get('channel') || 'stable'),
        isRequired: url.searchParams.get('isRequired') === 'true',
        notes: url.searchParams.get('notes') || '',
        fileBase64: '',
        zipBuffer,
      }
    : await readBody(request)
  let fileName = path.basename(String(body.fileName || ''))
  let version = String(body.version || '').trim()
  let signature = String(body.signature || '').trim()
  let fileBytes = null
  if (!fileName) {
    sendJson(response, 400, { ok: false, message: '\uD30C\uC77C\uBA85\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.' })
    return
  }
  const channel = normalizeChannel(body.channel || 'stable')
  if (body.zipBuffer || body.fileBase64) {
    try {
      const upload = body.zipBuffer
        ? prepareUpdateUploadFromZipBuffer(fileName, body.zipBuffer)
        : prepareUpdateUpload(fileName, body.fileBase64)
      fileName = upload.fileName
      signature = upload.signature || signature
      version = upload.version || version
      fileBytes = upload.fileBytes
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        message: error instanceof Error ? error.message : '\uC5C5\uB370\uC774\uD2B8 zip \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.',
      })
      return
    }
  }
  if (!version) {
    sendJson(response, 400, { ok: false, message: 'zip \uC548\uC758 \uC124\uCE58 \uD30C\uC77C\uBA85\uC5D0\uC11C \uBC84\uC804\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uBC84\uC804\uC744 \uC9C1\uC811 \uC785\uB825\uD574 \uC8FC\uC138\uC694.' })
    return
  }
  if (channel === 'stable' && !signature) {
    sendJson(response, 400, { ok: false, message: 'stable \uC790\uB3D9 \uC5C5\uB370\uC774\uD2B8\uC5D0\uB294 .sig \uC11C\uBA85 \uD30C\uC77C\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.' })
    return
  }
  if (fileBytes) {
    const releaseDir = path.join(STORAGE_DIR, channel)
    await mkdir(releaseDir, { recursive: true })
    const destination = path.join(releaseDir, fileName)
    const temporaryDestination = `${destination}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporaryDestination, fileBytes)
    await rename(temporaryDestination, destination)
  }
  const release = {
    id: randomBytes(8).toString('hex'),
    channel,
    version,
    target: String(body.target || 'windows'),
    arch: String(body.arch || 'x86_64'),
    fileName,
    notes: String(body.notes || ''),
    signature,
    isRequired: Boolean(body.isRequired),
    isActive: true,
    createdAt: nowIso(),
  }
  const data = await readData()
  data.releases.push(release)
  await writeData(data)
  sendJson(response, 200, { ok: true, release: releaseDto(release) })
}

async function handleDeleteRelease(request, response, releaseId) {
  const data = await readData()
  const release = data.releases.find((item) => item.id === releaseId)
  if (!release) {
    sendJson(response, 404, { ok: false, message: '??젣???낅뜲?댄듃瑜?李얠쓣 ???놁뒿?덈떎.' })
    return
  }

  data.releases = data.releases.filter((item) => item.id !== releaseId)

  const stillReferenced = data.releases.some(
    (item) => item.channel === release.channel && item.fileName === release.fileName,
  )
  let fileDeleted = false
  if (!stillReferenced && release.fileName) {
    const releasePath = path.join(STORAGE_DIR, release.channel, release.fileName)
    try {
      await unlink(releasePath)
      fileDeleted = true
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
        throw error
      }
    }
  }

  await writeData(data)
  sendJson(response, 200, {
    ok: true,
    deletedReleaseId: releaseId,
    fileDeleted,
    releases: sortReleases(data.releases).map(releaseDto),
  })
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

    if (request.method === 'GET' && url.pathname === '/') {
      sendHtml(response, 200, renderHomePage())
      return
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'litire-license-api', checkedAt: nowIso() })
      return
    }
    if (request.method === 'GET' && url.pathname === '/config/public') {
      sendJson(response, 200, await publicConfigPayload())
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/login') {
      await handleAdminLogin(request, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/logout') {
      clearAdminSessionCookie(response)
      sendJson(response, 200, { ok: true })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin') {
      if (!isAdmin(request, url)) {
        sendHtml(response, 200, renderAdminLoginPageFixed())
        return
      }
      sendHtml(response, 200, renderAdminPageFixed())
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
        sendJson(response, 401, { ok: false, message: '\uAD00\uB9AC\uC790 \uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.' })
        return
      }
      const data = await readData()
      sendJson(response, 200, { ok: true, licenses: sortLicenses(data.licenses), devices: data.devices })
      return
    }
    if (request.method === 'POST' && (url.pathname === '/admin/licenses' || url.pathname === '/admin/dev-license')) {
      if (url.pathname === '/admin/licenses' && !isAdmin(request, url)) {
        sendJson(response, 401, { ok: false, message: '\uAD00\uB9AC\uC790 \uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.' })
        return
      }
      await handleCreateLicense(request, response)
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/releases') {
      if (!isAdmin(request, url)) {
        sendJson(response, 401, { ok: false, message: '\uAD00\uB9AC\uC790 \uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.' })
        return
      }
      const data = await readData()
      sendJson(response, 200, { ok: true, releases: sortReleases(data.releases).map(releaseDto) })
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/releases') {
      if (!isAdmin(request, url)) {
        sendJson(response, 401, { ok: false, message: '\uAD00\uB9AC\uC790 \uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.' })
        return
      }
      await handleCreateRelease(request, response)
      return
    }
    const releaseDeleteMatch = url.pathname.match(/^\/admin\/releases\/([^/]+)$/)
    if (request.method === 'DELETE' && releaseDeleteMatch) {
      if (!isAdmin(request, url)) {
        sendJson(response, 401, { ok: false, message: '愿由ъ옄 ?좏겙???꾩슂?⑸땲??' })
        return
      }
      await handleDeleteRelease(request, response, decodeURIComponent(releaseDeleteMatch[1]))
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
    const latestJsonMatch = url.pathname.match(/^\/updates\/([^/]+)\/latest\.json$/)
    if (request.method === 'GET' && latestJsonMatch) {
      const [, channel] = latestJsonMatch
      const data = await readData()
      sendJson(response, 200, releaseManifest(latestRelease(data, channel, 'windows', 'x86_64'), '0.0.0'))
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
        sendJson(response, 404, { ok: false, message: '\uC5C5\uB370\uC774\uD2B8 \uD30C\uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.' })
      }
      return
    }

    sendJson(response, 404, { ok: false, message: '\uC694\uCCAD \uACBD\uB85C\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.' })
  } catch (error) {
    console.error(error)
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error instanceof Error ? error.message : '\uC11C\uBC84 \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.',
    })
  }
})

await ensureDirs()
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Litire license server listening on ${PORT}`)
})


