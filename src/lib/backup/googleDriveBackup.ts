import type { EncryptedDriveBackupPackage } from './encryptedBackup'

export type DriveBackupFile = {
  id: string
  name: string
  createdTime: string
  modifiedTime: string
  size: number
}

export type DriveSyncDecision = {
  action: 'restore_remote' | 'upload_local' | 'none'
  latestRemote: DriveBackupFile | null
  reason: string
}

type DriveFileResponse = {
  id?: string
  name?: string
  createdTime?: string
  modifiedTime?: string
  size?: string
}

const appPropertyKey = 'tireStoreBackup'

export async function uploadEncryptedBackupToDrive(
  accessToken: string,
  fileName: string,
  pack: EncryptedDriveBackupPackage,
) {
  const metadata = {
    name: fileName.endsWith('.tirebackup') ? fileName : `${fileName}.tirebackup`,
    mimeType: 'application/json',
    appProperties: {
      [appPropertyKey]: 'true',
    },
  }
  const body = new FormData()
  body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  body.append('file', new Blob([JSON.stringify(pack)], { type: 'application/json' }))

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size',
    {
      method: 'POST',
      headers: authHeaders(accessToken),
      body,
    },
  )
  return toBackupFile(await parseDriveResponse(response))
}

export async function listDriveBackups(accessToken: string): Promise<DriveBackupFile[]> {
  const params = new URLSearchParams({
    fields: 'files(id,name,createdTime,modifiedTime,size)',
    orderBy: 'createdTime desc',
    q: `appProperties has { key='${appPropertyKey}' and value='true' } and name contains '.tirebackup' and trashed = false`,
  })
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: authHeaders(accessToken),
  })
  const data = (await parseDriveResponse(response)) as { files?: DriveFileResponse[] }
  return (data.files ?? []).map(toBackupFile)
}

export async function downloadDriveBackup(accessToken: string, fileId: string): Promise<EncryptedDriveBackupPackage> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: authHeaders(accessToken),
  })
  const data = await parseDriveResponse(response)
  return data as EncryptedDriveBackupPackage
}

export async function deleteDriveBackup(accessToken: string, fileId: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Google Drive 백업 삭제에 실패했습니다. (${response.status})`)
  }
}

export async function enforceDriveBackupRetention(accessToken: string, keepCount: number) {
  const files = await listDriveBackups(accessToken)
  const removeTargets = files.slice(Math.max(1, keepCount))
  await Promise.all(removeTargets.map((file) => deleteDriveBackup(accessToken, file.id)))
  return { kept: files.length - removeTargets.length, removed: removeTargets.length }
}

export function decideDriveSync(files: DriveBackupFile[], lastLocalBackupAt: string, lastDriveBackupAt: string): DriveSyncDecision {
  const latestRemote = files[0] ?? null
  if (!latestRemote) {
    return { action: 'upload_local', latestRemote: null, reason: 'Drive 백업이 없어 현재 데이터를 첫 백업으로 올립니다.' }
  }

  const remoteTime = parseTime(latestRemote.modifiedTime || latestRemote.createdTime)
  const localTime = Math.max(parseTime(lastLocalBackupAt), parseTime(lastDriveBackupAt))
  if (remoteTime > localTime + 60_000) {
    return {
      action: 'restore_remote',
      latestRemote,
      reason: '다른 PC에서 만든 최신 Drive 백업이 있습니다. 복원 전에 내용을 확인해 주세요.',
    }
  }

  if (localTime > remoteTime + 60_000) {
    return { action: 'upload_local', latestRemote, reason: '현재 PC 데이터가 Drive 백업보다 최신입니다. Drive에 새 백업을 올립니다.' }
  }

  return { action: 'none', latestRemote, reason: 'Drive 백업과 현재 PC 백업 시간이 거의 같습니다.' }
}

function authHeaders(accessToken: string) {
  if (!accessToken.trim()) throw new Error('Google Drive access token이 없습니다.')
  return { Authorization: `Bearer ${accessToken}` }
}

async function parseDriveResponse(response: Response) {
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const message = typeof data?.error?.message === 'string' ? data.error.message : `Google Drive 요청에 실패했습니다. (${response.status})`
    throw new Error(message)
  }
  return data
}

function toBackupFile(file: DriveFileResponse): DriveBackupFile {
  return {
    id: String(file.id ?? ''),
    name: String(file.name ?? ''),
    createdTime: String(file.createdTime ?? ''),
    modifiedTime: String(file.modifiedTime ?? ''),
    size: Number(file.size ?? 0),
  }
}

function parseTime(value: string) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}
