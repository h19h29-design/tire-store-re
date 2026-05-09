import { execute, selectFirst } from '../../lib/db'
import type {
  BillingCheckoutSessionInput,
  BillingCheckoutSessionResult,
  BillingPlan,
  BillingPlanCode,
  BillingPreferences,
  LicenseStatus,
  TestBillingCheckoutInput,
  TestBillingCheckoutResult,
} from '../../lib/types'

const SERVER_BASE_URL_KEY = 'billing.serverBaseUrl'
const LOGIN_ID_KEY = 'billing.storeCode'
const LICENSE_KEY_KEY = 'billing.activationCode'
const DEVICE_ID_KEY = 'billing.deviceId'
const DEVICE_NAME_KEY = 'billing.deviceName'
const CHECKOUT_MODE_KEY = 'billing.checkoutMode'
const TOSS_CLIENT_KEY = 'billing.tossClientKey'
const TOSS_SECRET_KEY = 'billing.tossSecretKey'
const LAST_CHECKOUT_URL_KEY = 'billing.lastCheckoutUrl'
const LAST_VERIFIED_AT_KEY = 'billing.lastVerifiedAt'
const CACHED_STATUS_KEY = 'billing.cachedStatus'

type SettingRow = {
  value: string
}

type ServerLicenseResponse = {
  ok?: boolean
  email?: string
  licenseKey?: string
  status?: string
  message?: string
  expiresAt?: string | null
  offlineGraceDays?: number
  isInGracePeriod?: boolean
  graceRemainingDays?: number | null
  graceEndsAt?: string | null
  checkedAt?: string
  sessionToken?: string | null
}

export const DEFAULT_BILLING_SERVER_BASE_URL = 'https://litire.h19h19.synology.me'
export const DEFAULT_DEVICE_NAME = '매장 PC'
export const APP_VERSION = '1.89.0'

export const BILLING_PLANS: BillingPlan[] = [
  {
    code: 'monthly',
    name: '월간',
    description: '초기 설치비 99,000원 + 월 29,000원',
    initialChargeAmount: 128_000,
    recurringChargeAmount: 29_000,
    billingCycle: 'monthly',
  },
  {
    code: 'annual',
    name: '연간',
    description: '연 348,000원, 초기 설치비 면제',
    initialChargeAmount: 348_000,
    recurringChargeAmount: 348_000,
    billingCycle: 'annual',
  },
]

const defaultBillingPreferences: BillingPreferences = {
  serverBaseUrl: DEFAULT_BILLING_SERVER_BASE_URL,
  storeCode: '',
  activationCode: '',
  deviceId: '',
  deviceName: DEFAULT_DEVICE_NAME,
  checkoutMode: 'simulate',
  tossClientKey: '',
  tossSecretKey: '',
  lastCheckoutUrl: '',
  lastVerifiedAt: null,
  cachedStatus: null,
}

async function getSetting(key: string) {
  const row = await selectFirst<SettingRow>(
    'SELECT value AS value FROM app_settings WHERE key = ? LIMIT 1',
    [key],
  )
  return row?.value ?? ''
}

async function setSetting(key: string, value: string) {
  await execute(
    `INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  )
}

function normalizeBaseUrl(value: string) {
  return (value || DEFAULT_BILLING_SERVER_BASE_URL).trim().replace(/\/+$/, '')
}

function parseNullableDate(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed ? trimmed : null
}

function parseCachedStatus(rawValue: string): LicenseStatus | null {
  if (!rawValue.trim()) {
    return null
  }

  try {
    return normalizeLicenseStatus(JSON.parse(rawValue) as ServerLicenseResponse)
  } catch {
    return null
  }
}

function sanitizeBillingPreferences(preferences: BillingPreferences): BillingPreferences {
  return {
    serverBaseUrl: normalizeBaseUrl(preferences.serverBaseUrl),
    storeCode: String(preferences.storeCode || '').trim(),
    activationCode: String(preferences.activationCode || '').trim(),
    deviceId: String(preferences.deviceId || '').trim(),
    deviceName: String(preferences.deviceName || '').trim() || DEFAULT_DEVICE_NAME,
    checkoutMode: preferences.checkoutMode === 'toss' ? 'toss' : 'simulate',
    tossClientKey: String(preferences.tossClientKey || '').trim(),
    tossSecretKey: String(preferences.tossSecretKey || '').trim(),
    lastCheckoutUrl: String(preferences.lastCheckoutUrl || '').trim(),
    lastVerifiedAt: parseNullableDate(preferences.lastVerifiedAt),
    cachedStatus: preferences.cachedStatus ? normalizeLicenseStatus(preferences.cachedStatus) : null,
  }
}

async function fetchJson<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const text = await response.text()
  const payload = text.trim() ? JSON.parse(text) : {}

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : `서버가 오류 응답을 보냈습니다. (${response.status})`
    throw new Error(message)
  }

  return payload as T
}

function mapServerStatus(value: string | undefined): LicenseStatus['status'] {
  if (value === 'active' || value === 'trial') {
    return 'active'
  }
  if (value === 'grace' || value === 'grace_period') {
    return 'grace'
  }
  if (value === 'suspended' || value === 'revoked' || value === 'device_limit' || value === 'not_activated') {
    return 'suspended'
  }
  if (value === 'expired' || value === 'stale' || value === 'session_expired') {
    return 'expired'
  }
  return 'inactive'
}

function normalizeLicenseStatus(raw: ServerLicenseResponse | LicenseStatus): LicenseStatus {
  const maybeStatus = raw as LicenseStatus
  if ('storeCode' in maybeStatus && 'activationCodeMasked' in maybeStatus) {
    return {
      ...maybeStatus,
      expiresAt: parseNullableDate(maybeStatus.expiresAt),
      graceUntil: parseNullableDate(maybeStatus.graceUntil),
      nextBillingAt: parseNullableDate(maybeStatus.nextBillingAt),
      lastVerifiedAt: parseNullableDate(maybeStatus.lastVerifiedAt),
    }
  }

  const response = raw as ServerLicenseResponse
  const status = mapServerStatus(response.status)
  const offlineGraceDays = Number(response.offlineGraceDays ?? 7)
  const graceUntil = parseNullableDate(response.graceEndsAt)
  const expiresAt = parseNullableDate(response.expiresAt)

  return {
    status,
    storeCode: String(response.email ?? ''),
    storeName: String(response.email ?? ''),
    planCode: '',
    planName: status === 'active' ? '활성 라이선스' : '',
    billingCycle: '',
    isTestMode: false,
    deviceId: '',
    deviceName: '',
    deviceLimit: 1,
    registeredDeviceCount: 0,
    expiresAt,
    graceUntil,
    nextBillingAt: expiresAt,
    lastVerifiedAt: parseNullableDate(response.checkedAt) ?? new Date().toISOString(),
    activationCodeMasked: response.licenseKey ? `****${String(response.licenseKey).slice(-4)}` : '',
    message: String(response.message ?? defaultMessageForStatus(status, offlineGraceDays)),
  }
}

function defaultMessageForStatus(status: LicenseStatus['status'], offlineGraceDays = 7) {
  if (status === 'active') {
    return '라이선스가 정상적으로 활성화되어 있습니다.'
  }
  if (status === 'grace') {
    return `라이선스 서버 확인에 실패했지만 ${offlineGraceDays}일 유예 기간 동안 계속 사용할 수 있습니다.`
  }
  if (status === 'expired') {
    return '라이선스가 만료되었습니다. 결제 또는 갱신을 확인해 주세요.'
  }
  if (status === 'suspended') {
    return '라이선스가 중지되었거나 이 기기에서 사용할 수 없습니다. 관리자에게 문의해 주세요.'
  }
  return '라이선스 상태를 확인할 수 없습니다. 관리자에게 문의해 주세요.'
}

function createRequestBody(preferences: BillingPreferences) {
  return {
    email: preferences.storeCode,
    licenseKey: preferences.activationCode,
    deviceId: preferences.deviceId,
    deviceName: preferences.deviceName,
    appVersion: APP_VERSION,
  }
}

export function createFallbackLicenseStatus(message: string): LicenseStatus {
  return {
    status: 'inactive',
    storeCode: '',
    storeName: '',
    planCode: '',
    planName: '',
    billingCycle: '',
    isTestMode: false,
    deviceId: '',
    deviceName: '',
    deviceLimit: 1,
    registeredDeviceCount: 0,
    expiresAt: null,
    graceUntil: null,
    nextBillingAt: null,
    lastVerifiedAt: null,
    activationCodeMasked: '',
    message,
  }
}

export function isLicenseUsable(status: LicenseStatus | null) {
  return status?.status === 'active' || status?.status === 'grace'
}

export function isLicenseBlocking(status: LicenseStatus | null) {
  return Boolean(status) && !isLicenseUsable(status)
}

export function notifyLicenseStatusUpdated() {
  window.dispatchEvent(new CustomEvent('billing-license-updated'))
}

export function getBillingPlan(code: BillingPlanCode) {
  return BILLING_PLANS.find((plan) => plan.code === code) ?? BILLING_PLANS[0]
}

export async function loadBillingPreferences(): Promise<BillingPreferences> {
  const [
    serverBaseUrl,
    storeCode,
    activationCode,
    deviceId,
    deviceName,
    checkoutMode,
    tossClientKey,
    tossSecretKey,
    lastCheckoutUrl,
    lastVerifiedAt,
    cachedStatus,
  ] = await Promise.all([
    getSetting(SERVER_BASE_URL_KEY),
    getSetting(LOGIN_ID_KEY),
    getSetting(LICENSE_KEY_KEY),
    getSetting(DEVICE_ID_KEY),
    getSetting(DEVICE_NAME_KEY),
    getSetting(CHECKOUT_MODE_KEY),
    getSetting(TOSS_CLIENT_KEY),
    getSetting(TOSS_SECRET_KEY),
    getSetting(LAST_CHECKOUT_URL_KEY),
    getSetting(LAST_VERIFIED_AT_KEY),
    getSetting(CACHED_STATUS_KEY),
  ])

  return sanitizeBillingPreferences({
    ...defaultBillingPreferences,
    serverBaseUrl,
    storeCode,
    activationCode,
    deviceId,
    deviceName,
    checkoutMode: checkoutMode === 'toss' ? 'toss' : 'simulate',
    tossClientKey,
    tossSecretKey,
    lastCheckoutUrl,
    lastVerifiedAt,
    cachedStatus: parseCachedStatus(cachedStatus),
  })
}

export async function saveBillingPreferences(preferences: BillingPreferences) {
  const normalized = sanitizeBillingPreferences(preferences)

  await Promise.all([
    setSetting(SERVER_BASE_URL_KEY, normalized.serverBaseUrl),
    setSetting(LOGIN_ID_KEY, normalized.storeCode),
    setSetting(LICENSE_KEY_KEY, normalized.activationCode),
    setSetting(DEVICE_ID_KEY, normalized.deviceId),
    setSetting(DEVICE_NAME_KEY, normalized.deviceName),
    setSetting(CHECKOUT_MODE_KEY, normalized.checkoutMode),
    setSetting(TOSS_CLIENT_KEY, normalized.tossClientKey),
    setSetting(TOSS_SECRET_KEY, normalized.tossSecretKey),
    setSetting(LAST_CHECKOUT_URL_KEY, normalized.lastCheckoutUrl),
    setSetting(LAST_VERIFIED_AT_KEY, normalized.lastVerifiedAt ?? ''),
    setSetting(CACHED_STATUS_KEY, normalized.cachedStatus ? JSON.stringify(normalized.cachedStatus) : ''),
  ])

  return normalized
}

export async function ensureBillingDeviceId(preferences: BillingPreferences) {
  const normalized = sanitizeBillingPreferences(preferences)
  if (normalized.deviceId) {
    return normalized
  }

  return saveBillingPreferences({
    ...normalized,
    deviceId: crypto.randomUUID(),
  })
}

export async function activateBillingLicense(preferences: BillingPreferences) {
  const normalized = await ensureBillingDeviceId(preferences)
  const response = await fetchJson<ServerLicenseResponse>(`${normalized.serverBaseUrl}/licenses/activate`, {
    method: 'POST',
    body: JSON.stringify(createRequestBody(normalized)),
  })
  const status = normalizeLicenseStatus(response)
  const nextPreferences = await saveBillingPreferences({
    ...normalized,
    cachedStatus: status,
    lastVerifiedAt: new Date().toISOString(),
  })

  return {
    preferences: nextPreferences,
    status,
  }
}

export async function fetchBillingLicenseStatus(preferences: BillingPreferences) {
  const normalized = await ensureBillingDeviceId(preferences)
  try {
    const response = await fetchJson<ServerLicenseResponse>(`${normalized.serverBaseUrl}/licenses/check`, {
      method: 'POST',
      body: JSON.stringify(createRequestBody(normalized)),
    })
    const status = normalizeLicenseStatus(response)
    const nextPreferences = await saveBillingPreferences({
      ...normalized,
      cachedStatus: status,
      lastVerifiedAt: new Date().toISOString(),
    })

    return {
      preferences: nextPreferences,
      status,
    }
  } catch (error) {
    if (normalized.cachedStatus && isLicenseUsable(normalized.cachedStatus)) {
      return {
        preferences: normalized,
        status: {
          ...normalized.cachedStatus,
          message: '라이선스 서버에 연결할 수 없어 저장된 상태로 임시 사용 중입니다.',
        },
      }
    }
    throw error
  }
}

export async function createTestBillingCheckout(
  serverBaseUrl: string,
  input: TestBillingCheckoutInput,
): Promise<TestBillingCheckoutResult> {
  const response = await fetchJson<{
    license?: {
      email: string
      licenseKey: string
      status: string
      expiresAt: string | null
      graceEndsAt?: string | null
      offlineGraceDays?: number
    }
    email: string
    licenseKey: string
    status: ServerLicenseResponse
  }>(`${normalizeBaseUrl(serverBaseUrl)}/admin/dev-license`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const issuedLicense = response.license
  if (issuedLicense) {
    const status = normalizeLicenseStatus({
      email: issuedLicense.email,
      licenseKey: issuedLicense.licenseKey,
      status: issuedLicense.status,
      expiresAt: issuedLicense.expiresAt,
      graceEndsAt: issuedLicense.graceEndsAt,
      offlineGraceDays: issuedLicense.offlineGraceDays,
      message: '테스트 라이선스가 발급되었습니다.',
      checkedAt: new Date().toISOString(),
    })
    return {
      storeCode: issuedLicense.email,
      activationCode: issuedLicense.licenseKey,
      status,
    }
  }
  return {
    storeCode: response.email,
    activationCode: response.licenseKey,
    status: normalizeLicenseStatus(response.status),
  }
}

export async function createBillingCheckoutSession(
  preferences: BillingPreferences,
  input: BillingCheckoutSessionInput,
): Promise<{ preferences: BillingPreferences; session: BillingCheckoutSessionResult }> {
  const normalized = await ensureBillingDeviceId(preferences)
  const checkoutUrl = `${normalized.serverBaseUrl}/admin`
  const result = await createTestBillingCheckout(normalized.serverBaseUrl, input)
  const nextPreferences = await saveBillingPreferences({
    ...normalized,
    storeCode: result.storeCode,
    activationCode: result.activationCode,
    lastCheckoutUrl: checkoutUrl,
    cachedStatus: result.status,
    lastVerifiedAt: new Date().toISOString(),
  })

  return {
    preferences: nextPreferences,
    session: {
      sessionId: crypto.randomUUID(),
      storeCode: result.storeCode,
      activationCode: result.activationCode,
      checkoutUrl,
      status: result.status,
    },
  }
}

export type UpdateCheckResult = {
  ok: boolean
  updateAvailable: boolean
  currentVersion: string
  version: string
  channel: string
  notes: string
  pubDate: string
  url: string
  signature: string
  isRequired?: boolean
  fileName?: string
  message?: string
}

export async function checkForLicenseServerUpdates(
  serverBaseUrl: string,
  channel = 'stable',
  currentVersion = APP_VERSION,
): Promise<UpdateCheckResult> {
  return fetchJson<UpdateCheckResult>(
    `${normalizeBaseUrl(serverBaseUrl)}/updates/${encodeURIComponent(channel)}/windows/x86_64/${encodeURIComponent(currentVersion)}`,
  )
}
