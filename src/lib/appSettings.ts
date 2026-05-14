import { execute, selectFirst } from './db'
import type { DashboardDisplayPreferences, DashboardHeadlineScope } from './types'

type SettingRow = {
  value: string
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 4
export const DEFAULT_DASHBOARD_DISPLAY_PREFERENCES: DashboardDisplayPreferences = {
  headlineScope: 'month',
}

const LOW_STOCK_THRESHOLD_KEYS = ['inventory.lowStockThreshold', 'dashboard.lowStockThreshold'] as const
const DASHBOARD_HEADLINE_SCOPE_KEY = 'dashboard.headlineScope'

function parseNonNegativeInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }

  return parsed
}

function isDashboardHeadlineScope(value: string): value is DashboardHeadlineScope {
  return value === 'month' || value === 'year' || value === 'all'
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

export async function loadDashboardDisplayPreferences(): Promise<DashboardDisplayPreferences> {
  const row = await selectFirst<SettingRow>(
    'SELECT value AS value FROM app_settings WHERE key = ? LIMIT 1',
    [DASHBOARD_HEADLINE_SCOPE_KEY],
  )
  const headlineScope = row?.value.trim() ?? ''

  return {
    headlineScope: isDashboardHeadlineScope(headlineScope)
      ? headlineScope
      : DEFAULT_DASHBOARD_DISPLAY_PREFERENCES.headlineScope,
  }
}

export async function saveDashboardDisplayPreferences(preferences: DashboardDisplayPreferences) {
  const headlineScope = isDashboardHeadlineScope(preferences.headlineScope)
    ? preferences.headlineScope
    : DEFAULT_DASHBOARD_DISPLAY_PREFERENCES.headlineScope

  await execute(
    `INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [DASHBOARD_HEADLINE_SCOPE_KEY, headlineScope],
  )

  return { headlineScope }
}
