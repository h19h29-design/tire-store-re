import { deletePlatformSecret, getPlatformSecret, hasPlatformSecret, savePlatformSecret } from '../desktop'

export const driveRefreshTokenSecretCode = 'google-drive-refresh-token'
export const driveBackupPasswordSecretCode = 'google-drive-backup-password'

export function saveDriveRefreshToken(refreshToken: string) {
  return savePlatformSecret(driveRefreshTokenSecretCode, refreshToken)
}

export function getDriveRefreshToken() {
  return getPlatformSecret(driveRefreshTokenSecretCode)
}

export function deleteDriveRefreshToken() {
  return deletePlatformSecret(driveRefreshTokenSecretCode)
}

export function hasDriveRefreshToken() {
  return hasPlatformSecret(driveRefreshTokenSecretCode)
}

export function saveDriveBackupPassword(password: string) {
  return savePlatformSecret(driveBackupPasswordSecretCode, password)
}

export function getDriveBackupPassword() {
  return getPlatformSecret(driveBackupPasswordSecretCode)
}

export function deleteDriveBackupPassword() {
  return deletePlatformSecret(driveBackupPasswordSecretCode)
}
