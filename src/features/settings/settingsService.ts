import { execute, selectFirst } from '../../lib/db'
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  loadLowStockThresholdSetting,
  saveLowStockThresholdSetting,
} from '../../lib/appSettings'
import { normalizeText } from '../../lib/normalize'
import type { BackupPreferences, BrandDiscountRule, ProductDiscountRule, PublicQuotePreferences } from '../../lib/types'
import {
  DEFAULT_PUBLIC_QUOTE_NOTICE,
  DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL,
  DEFAULT_PUBLIC_QUOTE_SERVICE_AREA,
  DEFAULT_PUBLIC_QUOTE_STORE_NAME,
} from '../publicQuote/quoteUtils'

const BACKUP_FOLDER_KEY = 'backup.googleDriveFolderPath'
const GOOGLE_ACCOUNT_KEY = 'backup.googleDriveAccountEmail'
const AUTO_BACKUP_ENABLED_KEY = 'backup.autoBackupEnabled'
const AUTO_BACKUP_MEMO_KEY = 'backup.autoBackupMemo'
const BRAND_DISCOUNT_RULES_KEY = 'pricing.brandDiscountRules'
const PRODUCT_DISCOUNT_RULES_KEY = 'pricing.productDiscountRules'
const PUBLIC_QUOTE_ENABLED_KEY = 'publicQuote.enabled'
const PUBLIC_QUOTE_ENDPOINT_KEY = 'publicQuote.publishEndpoint'
const PUBLIC_QUOTE_AUTH_KEY = 'publicQuote.publishAuthKey'
const PUBLIC_QUOTE_STORE_NAME_KEY = 'publicQuote.storeName'
const PUBLIC_QUOTE_SERVICE_AREA_KEY = 'publicQuote.serviceArea'
const PUBLIC_QUOTE_PHONE_KEY = 'publicQuote.phoneNumber'
const PUBLIC_QUOTE_KAKAO_URL_KEY = 'publicQuote.kakaoUrl'
const PUBLIC_QUOTE_NAVER_URL_KEY = 'publicQuote.naverStoreUrl'
const PUBLIC_QUOTE_INSTALLATION_FEE_KEY = 'publicQuote.defaultInstallationFee'
const PUBLIC_QUOTE_ALIGNMENT_FEE_KEY = 'publicQuote.defaultAlignmentFee'
const PUBLIC_QUOTE_NOTICE_KEY = 'publicQuote.quoteNotice'
const PUBLIC_QUOTE_LAST_PUBLISHED_AT_KEY = 'publicQuote.lastPublishedAt'
const PUBLIC_QUOTE_LAST_PUBLISH_ERROR_KEY = 'publicQuote.lastPublishError'

type SettingRow = {
  value: string
}

const defaultPublicQuotePreferences: PublicQuotePreferences = {
  enabled: false,
  publishEndpoint: '',
  publishAuthKey: '',
  storeName: DEFAULT_PUBLIC_QUOTE_STORE_NAME,
  serviceArea: DEFAULT_PUBLIC_QUOTE_SERVICE_AREA,
  phoneNumber: '',
  kakaoUrl: '',
  naverStoreUrl: DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL,
  defaultInstallationFee: 0,
  defaultAlignmentFee: 0,
  quoteNotice: DEFAULT_PUBLIC_QUOTE_NOTICE,
  lastPublishedAt: null,
  lastPublishError: '',
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

export async function loadBackupPreferences(): Promise<BackupPreferences> {
  const [googleDriveAccountEmail, backupFolderPath, autoBackupEnabled, autoBackupMemo, lowStockThreshold] =
    await Promise.all([
      getSetting(GOOGLE_ACCOUNT_KEY),
      getSetting(BACKUP_FOLDER_KEY),
      getSetting(AUTO_BACKUP_ENABLED_KEY),
      getSetting(AUTO_BACKUP_MEMO_KEY),
      loadLowStockThresholdSetting(DEFAULT_LOW_STOCK_THRESHOLD),
    ])

  return {
    googleDriveAccountEmail,
    backupFolderPath,
    autoBackupEnabled: autoBackupEnabled === 'true',
    autoBackupMemo,
    lowStockThreshold,
  }
}

export async function loadLowStockThreshold() {
  return loadLowStockThresholdSetting(DEFAULT_LOW_STOCK_THRESHOLD)
}

export async function saveBackupPreferences(preferences: BackupPreferences) {
  const lowStockThreshold = Number.isFinite(preferences.lowStockThreshold)
    ? Math.max(0, Math.floor(preferences.lowStockThreshold))
    : DEFAULT_LOW_STOCK_THRESHOLD

  await Promise.all([
    setSetting(GOOGLE_ACCOUNT_KEY, preferences.googleDriveAccountEmail.trim()),
    setSetting(BACKUP_FOLDER_KEY, preferences.backupFolderPath.trim()),
    setSetting(AUTO_BACKUP_ENABLED_KEY, String(preferences.autoBackupEnabled)),
    setSetting(AUTO_BACKUP_MEMO_KEY, preferences.autoBackupMemo.trim()),
    saveLowStockThresholdSetting(lowStockThreshold),
  ])
}

function normalizeDiscountRate(value: unknown) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100))
}

function sanitizeBrandDiscountRules(value: unknown): BrandDiscountRule[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const rules: BrandDiscountRule[] = []

  for (const entry of value) {
    const brandName =
      typeof entry === 'object' && entry && 'brandName' in entry ? String(entry.brandName ?? '').trim() : ''
    const normalizedBrand = normalizeText(brandName)
    if (!normalizedBrand || seen.has(normalizedBrand)) {
      continue
    }

    const discountRate =
      typeof entry === 'object' && entry && 'discountRate' in entry
        ? normalizeDiscountRate(entry.discountRate)
        : 0

    if (discountRate <= 0) {
      continue
    }

    seen.add(normalizedBrand)
    rules.push({
      brandName,
      discountRate,
    })
  }

  return rules.sort((left, right) => left.brandName.localeCompare(right.brandName, 'ko-KR'))
}

function sanitizeProductDiscountRules(value: unknown): ProductDiscountRule[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const rules: ProductDiscountRule[] = []

  for (const entry of value) {
    const productName =
      typeof entry === 'object' && entry && 'productName' in entry ? String(entry.productName ?? '').trim() : ''
    const normalizedProduct = normalizeText(productName)
    if (!normalizedProduct || seen.has(normalizedProduct)) {
      continue
    }

    const discountRate =
      typeof entry === 'object' && entry && 'discountRate' in entry
        ? normalizeDiscountRate(entry.discountRate)
        : 0

    if (discountRate <= 0) {
      continue
    }

    seen.add(normalizedProduct)
    rules.push({
      productName,
      discountRate,
    })
  }

  return rules.sort((left, right) => left.productName.localeCompare(right.productName, 'ko-KR'))
}

function sanitizeBooleanString(value: string) {
  return value.trim().toLowerCase() === 'true'
}

function sanitizeNonNegativeMoney(value: string) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, Math.round(numeric))
}

function sanitizeNullableDate(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function sanitizePublicQuotePreferences(preferences: PublicQuotePreferences): PublicQuotePreferences {
  return {
    enabled: Boolean(preferences.enabled),
    publishEndpoint: preferences.publishEndpoint.trim(),
    publishAuthKey: preferences.publishAuthKey.trim(),
    storeName: preferences.storeName.trim() || DEFAULT_PUBLIC_QUOTE_STORE_NAME,
    serviceArea: preferences.serviceArea.trim() || DEFAULT_PUBLIC_QUOTE_SERVICE_AREA,
    phoneNumber: preferences.phoneNumber.trim(),
    kakaoUrl: preferences.kakaoUrl.trim(),
    naverStoreUrl: preferences.naverStoreUrl.trim() || DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL,
    defaultInstallationFee: sanitizeNonNegativeMoney(String(preferences.defaultInstallationFee ?? 0)),
    defaultAlignmentFee: sanitizeNonNegativeMoney(String(preferences.defaultAlignmentFee ?? 0)),
    quoteNotice: preferences.quoteNotice.trim() || DEFAULT_PUBLIC_QUOTE_NOTICE,
    lastPublishedAt: sanitizeNullableDate(preferences.lastPublishedAt ?? ''),
    lastPublishError: preferences.lastPublishError.trim(),
  }
}

export async function loadBrandDiscountRules(): Promise<BrandDiscountRule[]> {
  const rawValue = await getSetting(BRAND_DISCOUNT_RULES_KEY)
  if (!rawValue.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(rawValue)
    return sanitizeBrandDiscountRules(parsed)
  } catch {
    return []
  }
}

export async function saveBrandDiscountRules(rules: BrandDiscountRule[]) {
  const normalizedRules = sanitizeBrandDiscountRules(rules)
  await setSetting(BRAND_DISCOUNT_RULES_KEY, JSON.stringify(normalizedRules))
  return normalizedRules
}

export async function loadProductDiscountRules(): Promise<ProductDiscountRule[]> {
  const rawValue = await getSetting(PRODUCT_DISCOUNT_RULES_KEY)
  if (!rawValue.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(rawValue)
    return sanitizeProductDiscountRules(parsed)
  } catch {
    return []
  }
}

export async function saveProductDiscountRules(rules: ProductDiscountRule[]) {
  const normalizedRules = sanitizeProductDiscountRules(rules)
  await setSetting(PRODUCT_DISCOUNT_RULES_KEY, JSON.stringify(normalizedRules))
  return normalizedRules
}

export async function loadPublicQuotePreferences(): Promise<PublicQuotePreferences> {
  const [
    enabled,
    publishEndpoint,
    publishAuthKey,
    storeName,
    serviceArea,
    phoneNumber,
    kakaoUrl,
    naverStoreUrl,
    defaultInstallationFee,
    defaultAlignmentFee,
    quoteNotice,
    lastPublishedAt,
    lastPublishError,
  ] = await Promise.all([
    getSetting(PUBLIC_QUOTE_ENABLED_KEY),
    getSetting(PUBLIC_QUOTE_ENDPOINT_KEY),
    getSetting(PUBLIC_QUOTE_AUTH_KEY),
    getSetting(PUBLIC_QUOTE_STORE_NAME_KEY),
    getSetting(PUBLIC_QUOTE_SERVICE_AREA_KEY),
    getSetting(PUBLIC_QUOTE_PHONE_KEY),
    getSetting(PUBLIC_QUOTE_KAKAO_URL_KEY),
    getSetting(PUBLIC_QUOTE_NAVER_URL_KEY),
    getSetting(PUBLIC_QUOTE_INSTALLATION_FEE_KEY),
    getSetting(PUBLIC_QUOTE_ALIGNMENT_FEE_KEY),
    getSetting(PUBLIC_QUOTE_NOTICE_KEY),
    getSetting(PUBLIC_QUOTE_LAST_PUBLISHED_AT_KEY),
    getSetting(PUBLIC_QUOTE_LAST_PUBLISH_ERROR_KEY),
  ])

  return sanitizePublicQuotePreferences({
    ...defaultPublicQuotePreferences,
    enabled: sanitizeBooleanString(enabled),
    publishEndpoint,
    publishAuthKey,
    storeName,
    serviceArea,
    phoneNumber,
    kakaoUrl,
    naverStoreUrl,
    defaultInstallationFee: sanitizeNonNegativeMoney(defaultInstallationFee),
    defaultAlignmentFee: sanitizeNonNegativeMoney(defaultAlignmentFee),
    quoteNotice,
    lastPublishedAt: sanitizeNullableDate(lastPublishedAt),
    lastPublishError,
  })
}

export async function savePublicQuotePreferences(preferences: PublicQuotePreferences) {
  const normalizedPreferences = sanitizePublicQuotePreferences(preferences)

  await Promise.all([
    setSetting(PUBLIC_QUOTE_ENABLED_KEY, String(normalizedPreferences.enabled)),
    setSetting(PUBLIC_QUOTE_ENDPOINT_KEY, normalizedPreferences.publishEndpoint),
    setSetting(PUBLIC_QUOTE_AUTH_KEY, normalizedPreferences.publishAuthKey),
    setSetting(PUBLIC_QUOTE_STORE_NAME_KEY, normalizedPreferences.storeName),
    setSetting(PUBLIC_QUOTE_SERVICE_AREA_KEY, normalizedPreferences.serviceArea),
    setSetting(PUBLIC_QUOTE_PHONE_KEY, normalizedPreferences.phoneNumber),
    setSetting(PUBLIC_QUOTE_KAKAO_URL_KEY, normalizedPreferences.kakaoUrl),
    setSetting(PUBLIC_QUOTE_NAVER_URL_KEY, normalizedPreferences.naverStoreUrl),
    setSetting(PUBLIC_QUOTE_INSTALLATION_FEE_KEY, String(normalizedPreferences.defaultInstallationFee)),
    setSetting(PUBLIC_QUOTE_ALIGNMENT_FEE_KEY, String(normalizedPreferences.defaultAlignmentFee)),
    setSetting(PUBLIC_QUOTE_NOTICE_KEY, normalizedPreferences.quoteNotice),
    setSetting(PUBLIC_QUOTE_LAST_PUBLISHED_AT_KEY, normalizedPreferences.lastPublishedAt ?? ''),
    setSetting(PUBLIC_QUOTE_LAST_PUBLISH_ERROR_KEY, normalizedPreferences.lastPublishError),
  ])

  return normalizedPreferences
}

export async function savePublicQuotePublishState(input: {
  lastPublishedAt: string | null
  lastPublishError: string
}) {
  const nextPublishedAt = sanitizeNullableDate(input.lastPublishedAt ?? '')
  const nextPublishError = input.lastPublishError.trim()

  await Promise.all([
    setSetting(PUBLIC_QUOTE_LAST_PUBLISHED_AT_KEY, nextPublishedAt ?? ''),
    setSetting(PUBLIC_QUOTE_LAST_PUBLISH_ERROR_KEY, nextPublishError),
  ])

  return {
    lastPublishedAt: nextPublishedAt,
    lastPublishError: nextPublishError,
  }
}
