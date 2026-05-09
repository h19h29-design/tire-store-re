export type DriveBackupSettings = {
  apiBaseUrl: string
  enabled: boolean
  deviceClientId: string
  deviceClientSecret: string
  retentionCount: number
  syncOnStartup: boolean
  syncOnExit: boolean
  rememberPassword: boolean
}

const settingsKey = 'tireStore.driveBackup.settings'

const defaultSettings: DriveBackupSettings = {
  apiBaseUrl: 'https://litire.h19h19.synology.me',
  enabled: false,
  deviceClientId: '',
  deviceClientSecret: '',
  retentionCount: 10,
  syncOnStartup: false,
  syncOnExit: false,
  rememberPassword: false,
}

export function loadDriveBackupSettings(): DriveBackupSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(settingsKey) || '{}') as Partial<DriveBackupSettings>
    return {
      ...defaultSettings,
      ...parsed,
      enabled: Boolean(parsed.enabled),
      retentionCount: Math.max(1, Math.min(50, Number(parsed.retentionCount || defaultSettings.retentionCount))),
      syncOnStartup: Boolean(parsed.syncOnStartup),
      syncOnExit: Boolean(parsed.syncOnExit),
      rememberPassword: Boolean(parsed.rememberPassword),
    }
  } catch {
    return defaultSettings
  }
}

export function saveDriveBackupSettings(settings: DriveBackupSettings) {
  window.localStorage.setItem(settingsKey, JSON.stringify(settings))
}

export async function fetchPublicServerConfig(apiBaseUrl: string) {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}/config/public`)
  if (!response.ok) {
    throw new Error(`공개 설정 조회 실패: HTTP ${response.status}`)
  }
  return (await response.json()) as {
    ok: boolean
    serverVersion?: string
    publicApiBaseUrl?: string
    googleDeviceClientId?: string
    googleDeviceClientSecret?: string
  }
}
