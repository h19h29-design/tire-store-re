import { execute, selectFirst } from './db'

type SettingRow = {
  value: string
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 4

const LOW_STOCK_THRESHOLD_KEYS = ['inventory.lowStockThreshold', 'dashboard.lowStockThreshold'] as const

function parseNonNegativeInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }

  return parsed
}

export async function loadLowStockThresholdSetting(
  fallback = DEFAULT_LOW_STOCK_THRESHOLD,
) {
  const rows = await Promise.all(
    LOW_STOCK_THRESHOLD_KEYS.map((key) =>
      selectFirst<SettingRow>(
        'SELECT value AS value FROM app_settings WHERE key = ? LIMIT 1',
        [key],
      ),
    ),
  )

  const value = rows.find((row) => row?.value.trim())?.value ?? ''
  return parseNonNegativeInteger(value, fallback)
}

export async function saveLowStockThresholdSetting(value: number) {
  const normalizedValue = Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : DEFAULT_LOW_STOCK_THRESHOLD

  await Promise.all(
    LOW_STOCK_THRESHOLD_KEYS.map((key) =>
      execute(
        `INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, String(normalizedValue)],
      ),
    ),
  )

  return normalizedValue
}
