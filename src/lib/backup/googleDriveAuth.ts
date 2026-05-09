import { loadDriveBackupSettings } from './backupSettings'

export const googleDriveAppDataScope = 'https://www.googleapis.com/auth/drive.file'

export type GoogleDriveDeviceAuthorization = {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

export type GoogleDriveTokenResult = {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

type DeviceCodeResponse = {
  device_code?: string
  user_code?: string
  verification_url?: string
  verification_uri?: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
  error?: string
  error_description?: string
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

const defaultServerUrl = 'https://litire.h19h19.synology.me'
const deviceClientIdOverrideKey = 'tireStore.googleDrive.deviceClientId'
const deviceClientSecretOverrideKey = 'tireStore.googleDrive.deviceClientSecret'
const envGoogleDeviceClientId = String(
  ((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_GOOGLE_DEVICE_CLIENT_ID) ?? '',
)
const envGoogleDeviceClientSecret = String(
  ((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_GOOGLE_DEVICE_CLIENT_SECRET) ?? '',
)

let cachedDeviceClientId: string | null = null
let cachedDeviceClientSecret: string | null = null
let cachedDriveToken: { accessToken: string; expiresAt: number } | null = null

export async function resolveGoogleDriveDeviceClientId(preferredApiBaseUrl?: string): Promise<string> {
  if (envGoogleDeviceClientId.trim()) return envGoogleDeviceClientId.trim()

  const overrideClientId = getGoogleDriveDeviceClientIdOverride()
  if (overrideClientId) {
    cachedDeviceClientId = overrideClientId
    return overrideClientId
  }

  if (cachedDeviceClientId) return cachedDeviceClientId

  for (const apiBaseUrl of candidateConfigBaseUrls(preferredApiBaseUrl)) {
    const clientId = await loadGoogleDriveDeviceClientIdFromServer(apiBaseUrl)
    if (clientId) {
      cachedDeviceClientId = clientId
      return clientId
    }
  }

  throw new Error(
    "Google Drive 기기용 Client ID가 설정되지 않았습니다. 서버 GOOGLE_DEVICE_CLIENT_ID를 설정하거나 화면에 직접 입력해 주세요.",
  )
}

export function getGoogleDriveDeviceClientIdOverride() {
  return window.localStorage.getItem(deviceClientIdOverrideKey)?.trim() ?? ''
}

export function saveGoogleDriveDeviceClientIdOverride(clientId: string) {
  const trimmed = clientId.trim()
  cachedDeviceClientId = null
  if (trimmed) {
    window.localStorage.setItem(deviceClientIdOverrideKey, trimmed)
  } else {
    window.localStorage.removeItem(deviceClientIdOverrideKey)
  }
}

export async function resolveGoogleDriveDeviceClientSecret(preferredApiBaseUrl?: string): Promise<string> {
  if (envGoogleDeviceClientSecret.trim()) return envGoogleDeviceClientSecret.trim()

  const overrideClientSecret = getGoogleDriveDeviceClientSecretOverride()
  if (overrideClientSecret) {
    cachedDeviceClientSecret = overrideClientSecret
    return overrideClientSecret
  }

  if (cachedDeviceClientSecret) return cachedDeviceClientSecret

  for (const apiBaseUrl of candidateConfigBaseUrls(preferredApiBaseUrl)) {
    const clientSecret = await loadGoogleDriveDeviceClientSecretFromServer(apiBaseUrl)
    if (clientSecret) {
      cachedDeviceClientSecret = clientSecret
      return clientSecret
    }
  }

  throw new Error(
    'Google Drive 기기용 Client Secret이 설정되지 않았습니다. 서버 GOOGLE_DEVICE_CLIENT_SECRET을 설정하거나 화면에 직접 입력해 주세요.',
  )
}

export function getGoogleDriveDeviceClientSecretOverride() {
  return window.localStorage.getItem(deviceClientSecretOverrideKey)?.trim() ?? ''
}

export function saveGoogleDriveDeviceClientSecretOverride(clientSecret: string) {
  const trimmed = clientSecret.trim()
  cachedDeviceClientSecret = null
  if (trimmed) {
    window.localStorage.setItem(deviceClientSecretOverrideKey, trimmed)
  } else {
    window.localStorage.removeItem(deviceClientSecretOverrideKey)
  }
}

export async function requestGoogleDriveDeviceAuthorization(clientId: string): Promise<GoogleDriveDeviceAuthorization> {
  assertGoogleClientId(clientId)
  const response = await fetch('https://oauth2.googleapis.com/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: googleDriveAppDataScope }),
  })
  const data = (await response.json().catch(() => ({}))) as DeviceCodeResponse
  if (!response.ok) throw new Error(formatDeviceFlowError(data))

  const deviceCode = String(data.device_code ?? '')
  const userCode = String(data.user_code ?? '')
  const verificationUrl = String(data.verification_url ?? data.verification_uri ?? '')
  if (!deviceCode || !userCode || !verificationUrl) {
    throw new Error('Google Drive 기기 인증 응답을 읽지 못했습니다. Drive 연결을 다시 시도해 주세요.')
  }

  return {
    deviceCode,
    userCode,
    verificationUrl,
    expiresIn: Number(data.expires_in ?? 1800),
    interval: Number(data.interval ?? 5),
  }
}

export async function pollGoogleDriveDeviceToken(
  clientId: string,
  clientSecret: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
) {
  const startedAt = Date.now()
  let intervalMs = Math.max(1, intervalSeconds) * 1000
  while (Date.now() - startedAt < expiresInSeconds * 1000) {
    await delay(intervalMs)
    const result = await requestDeviceToken(clientId, clientSecret, deviceCode)
    if (result.status === 'success') return result.token
    if (result.error === 'authorization_pending') continue
    if (result.error === 'slow_down') {
      intervalMs += 5000
      continue
    }
    throw new Error(formatDeviceFlowError(result.raw))
  }
  throw new Error('Google Drive 승인 시간이 만료되었습니다. Drive 연결을 다시 눌러 주세요.')
}

export async function refreshGoogleDriveAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  assertGoogleClientId(clientId)
  assertGoogleClientSecret(clientSecret)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok) throw new Error(formatDeviceFlowError(data))
  return storeTokenResult(data, refreshToken)
}

export function getCachedGoogleDriveAccessToken() {
  if (!cachedDriveToken) return ''
  if (cachedDriveToken.expiresAt <= Date.now()) {
    cachedDriveToken = null
    return ''
  }
  return cachedDriveToken.accessToken
}

export function clearCachedGoogleDriveAccessToken() {
  cachedDriveToken = null
}

function assertGoogleClientId(clientId: string) {
  if (!clientId.trim()) throw new Error('Google Drive 백업용 Client ID가 설정되지 않았습니다.')
  if (!isLikelyGoogleClientId(clientId)) {
    throw new Error('Google Drive Client ID 형식이 올바르지 않습니다. Google Cloud에서 발급한 값을 확인해 주세요.')
  }
}

function assertGoogleClientSecret(clientSecret: string) {
  if (!clientSecret.trim()) throw new Error('Google Drive 기기용 Client Secret이 설정되지 않았습니다.')
}

function candidateConfigBaseUrls(preferredApiBaseUrl?: string) {
  let configured = ''
  try {
    configured = loadDriveBackupSettings().apiBaseUrl
  } catch {
    configured = ''
  }
  return [...new Set([preferredApiBaseUrl, configured, defaultServerUrl].map((value) => String(value || '').replace(/\/+$/, '')))].filter(
    Boolean,
  )
}

async function loadGoogleDriveDeviceClientIdFromServer(apiBaseUrl: string) {
  try {
    const response = await fetch(`${apiBaseUrl}/config/public`)
    const data = (await response.json().catch(() => ({}))) as { googleDeviceClientId?: string }
    const clientId = String(data.googleDeviceClientId ?? '').trim()
    return response.ok && clientId ? clientId : ''
  } catch {
    return ''
  }
}

async function loadGoogleDriveDeviceClientSecretFromServer(apiBaseUrl: string) {
  try {
    const response = await fetch(`${apiBaseUrl}/config/public`)
    const data = (await response.json().catch(() => ({}))) as { googleDeviceClientSecret?: string }
    const clientSecret = String(data.googleDeviceClientSecret ?? '').trim()
    return response.ok && clientSecret ? clientSecret : ''
  } catch {
    return ''
  }
}

function isLikelyGoogleClientId(clientId: string) {
  return /^[0-9A-Za-z_-]+-[0-9A-Za-z_-]+\.apps\.googleusercontent\.com$/.test(clientId.trim())
}

async function requestDeviceToken(
  clientId: string,
  clientSecret: string,
  deviceCode: string,
): Promise<
  | { status: 'success'; token: GoogleDriveTokenResult; error?: never; raw: TokenResponse }
  | { status: 'pending'; token?: never; error: string; raw: TokenResponse }
> {
  assertGoogleClientId(clientId)
  assertGoogleClientSecret(clientSecret)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  const data = (await response.json().catch(() => ({}))) as TokenResponse
  if (response.ok) return { status: 'success', token: storeTokenResult(data), raw: data }
  return { status: 'pending', error: String(data.error ?? 'unknown'), raw: data }
}

function storeTokenResult(data: TokenResponse, fallbackRefreshToken = ''): GoogleDriveTokenResult {
  const accessToken = String(data.access_token ?? '')
  if (!accessToken) throw new Error('Google Drive access token을 받지 못했습니다.')
  const expiresIn = Number(data.expires_in ?? 3600)
  cachedDriveToken = {
    accessToken,
    expiresAt: Date.now() + Math.max(1, expiresIn - 60) * 1000,
  }
  return {
    accessToken,
    refreshToken: String(data.refresh_token ?? fallbackRefreshToken),
    expiresIn,
  }
}

function formatDeviceFlowError(data: TokenResponse | DeviceCodeResponse) {
  const error = String(data.error ?? '')
  const description = String(data.error_description ?? '')
  if (description.includes('client_secret')) {
    return 'Google Drive 기기용 Client Secret이 필요합니다. NAS 서버 GOOGLE_DEVICE_CLIENT_SECRET 설정을 확인해 주세요.'
  }
  if (error === 'invalid_client' && description.includes('Limited Input')) {
    return "Google Drive에는 'TVs and Limited Input devices' Client ID가 필요합니다. NAS 서버 GOOGLE_DEVICE_CLIENT_ID 설정을 확인해 주세요."
  }
  if (error === 'access_denied') return 'Google Drive 권한 승인이 취소되었습니다.'
  if (error === 'expired_token') return 'Google Drive 승인 시간이 만료되었습니다. Drive 연결을 다시 눌러 주세요.'
  return description || error || 'Google Drive 기기 인증에 실패했습니다.'
}

function delay(ms: number) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms)
  })
}
