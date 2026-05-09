import { exportDatabaseBackupPayload } from '../desktop'
import { loadDriveBackupSettings } from './backupSettings'
import { encryptBackupPayload } from './encryptedBackup'
import { enforceDriveBackupRetention, uploadEncryptedBackupToDrive, type DriveBackupFile } from './googleDriveBackup'
import {
  getCachedGoogleDriveAccessToken,
  refreshGoogleDriveAccessToken,
  resolveGoogleDriveDeviceClientId,
  resolveGoogleDriveDeviceClientSecret,
} from './googleDriveAuth'
import { getDriveBackupPassword, getDriveRefreshToken } from './platformSecrets'

export type DriveAutoBackupTrigger = 'startup' | 'exit'

export type DriveAutoBackupResult =
  | { action: 'disabled' | 'missing_token' | 'missing_password'; message: string }
  | { action: 'uploaded'; message: string; file: DriveBackupFile }
  | { action: 'failed'; message: string; error?: Error }

export async function runDriveAutoBackup(trigger: DriveAutoBackupTrigger): Promise<DriveAutoBackupResult> {
  const settings = loadDriveBackupSettings()
  if (!settings.enabled) {
    return { action: 'disabled', message: 'Google Drive 자동 백업이 꺼져 있습니다.' }
  }
  if (trigger === 'startup' && !settings.syncOnStartup) {
    return { action: 'disabled', message: '시작 시 Drive 확인이 꺼져 있습니다.' }
  }
  if (trigger === 'exit' && !settings.syncOnExit) {
    return { action: 'disabled', message: '종료 시 Drive 백업이 꺼져 있습니다.' }
  }

  const [refreshToken, password] = await Promise.all([getDriveRefreshToken(), getDriveBackupPassword()])
  if (!refreshToken) {
    return { action: 'missing_token', message: 'Google Drive 연결 토큰이 없습니다. 백업/복원 화면에서 Drive 연결을 한 번 진행해 주세요.' }
  }
  if (!password?.trim()) {
    return { action: 'missing_password', message: '자동 백업을 사용하려면 백업 암호 안전 저장을 켜고 암호를 저장해 주세요.' }
  }

  try {
    const accessToken = await getDriveAccessToken(settings.apiBaseUrl, refreshToken, trigger)
    if (!accessToken) {
      return { action: 'missing_token', message: 'Google Drive 토큰을 갱신하지 못해 자동 백업을 건너뛰었습니다.' }
    }
    const uploaded = await createEncryptedDriveBackup(accessToken, password, settings.retentionCount)
    return { action: 'uploaded', file: uploaded, message: `Google Drive 자동 백업 완료: ${uploaded.name}` }
  } catch (error) {
    return {
      action: 'failed',
      message: error instanceof Error ? error.message : 'Google Drive 자동 백업에 실패했습니다.',
      error: error instanceof Error ? error : undefined,
    }
  }
}

async function createEncryptedDriveBackup(accessToken: string, password: string, retentionCount: number) {
  const payload = await exportDatabaseBackupPayload()
  const pack = await encryptBackupPayload(payload, password)
  const uploaded = await uploadEncryptedBackupToDrive(accessToken, payload.fileName, pack)
  await enforceDriveBackupRetention(accessToken, retentionCount)
  markDriveBackupTimestamp()
  return uploaded
}

async function getDriveAccessToken(apiBaseUrl: string, refreshToken: string, trigger: DriveAutoBackupTrigger) {
  const cachedToken = getCachedGoogleDriveAccessToken()
  if (cachedToken) return cachedToken

  const clientId = await resolveGoogleDriveDeviceClientId(apiBaseUrl)
  const clientSecret = await resolveGoogleDriveDeviceClientSecret(apiBaseUrl)
  const refreshed = refreshGoogleDriveAccessToken(clientId, clientSecret, refreshToken).then((token) => token.accessToken)
  return trigger === 'exit' ? await withTimeout(refreshed, 8000, '') : await refreshed
}

function markDriveBackupTimestamp() {
  const exportedAt = new Date().toISOString()
  window.localStorage.setItem('tireStore.lastDriveBackupAt', exportedAt)
  window.localStorage.setItem('tireStore.lastBackupAt', exportedAt)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs)
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => window.clearTimeout(timer))
  })
}
