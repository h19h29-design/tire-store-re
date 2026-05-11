import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  deleteDriveBackupPassword,
  getDriveBackupPassword,
  getDriveRefreshToken,
  hasDriveRefreshToken,
  saveDriveBackupPassword,
  saveDriveRefreshToken,
} from '../../lib/backup/platformSecrets'
import { decryptBackupPackage, encryptBackupPayload } from '../../lib/backup/encryptedBackup'
import {
  decideDriveSync,
  deleteDriveBackup,
  downloadDriveBackup,
  enforceDriveBackupRetention,
  listDriveBackups,
  uploadEncryptedBackupToDrive,
  type DriveBackupFile,
} from '../../lib/backup/googleDriveBackup'
import { fetchPublicServerConfig, loadDriveBackupSettings, saveDriveBackupSettings, type DriveBackupSettings } from '../../lib/backup/backupSettings'
import {
  getGoogleDriveDeviceClientIdOverride,
  getGoogleDriveDeviceClientSecretOverride,
  pollGoogleDriveDeviceToken,
  refreshGoogleDriveAccessToken,
  requestGoogleDriveDeviceAuthorization,
  resolveGoogleDriveDeviceClientId,
  resolveGoogleDriveDeviceClientSecret,
  saveGoogleDriveDeviceClientIdOverride,
  saveGoogleDriveDeviceClientSecretOverride,
  type GoogleDriveDeviceAuthorization,
} from '../../lib/backup/googleDriveAuth'
import { createBackup, exportDatabaseBackupPayload, restoreDatabaseFromBase64, restoreDatabaseFromPath } from '../../lib/desktop'
import { closeDatabase } from '../../lib/db'

type DriveAuthNotice = Pick<GoogleDriveDeviceAuthorization, 'userCode' | 'verificationUrl'>

export function BackupRestorePage() {
  const [settings, setSettings] = useState<DriveBackupSettings>(() => loadDriveBackupSettings())
  const [password, setPassword] = useState('')
  const [connected, setConnected] = useState(false)
  const [deviceAuth, setDeviceAuth] = useState<DriveAuthNotice | null>(null)
  const [files, setFiles] = useState<DriveBackupFile[]>([])
  const [selectedFileId, setSelectedFileId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Google Drive 백업 설정을 확인해 주세요.')
  const [lastDriveBackupAt, setLastDriveBackupAt] = useState(() => window.localStorage.getItem('tireStore.lastDriveBackupAt') || '')
  const [deviceClientIdOverride, setDeviceClientIdOverride] = useState(() => getGoogleDriveDeviceClientIdOverride())
  const [deviceClientSecretOverride, setDeviceClientSecretOverride] = useState(() => getGoogleDriveDeviceClientSecretOverride())

  const selectedFile = useMemo(() => files.find((file) => file.id === selectedFileId) || null, [files, selectedFileId])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [hasToken, savedPassword] = await Promise.all([hasDriveRefreshToken(), getDriveBackupPassword()])
        if (!active) return
        setConnected(hasToken)
        if (savedPassword) setPassword(savedPassword)
      } catch (error) {
        console.error('Failed to load drive backup secrets', error)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      const initialSettings = loadDriveBackupSettings()
      try {
        const config = await fetchPublicServerConfig(initialSettings.apiBaseUrl)
        if (!active) return
        const next = {
          ...initialSettings,
          deviceClientId: config.googleDeviceClientId || initialSettings.deviceClientId,
          deviceClientSecret: config.googleDeviceClientSecret || initialSettings.deviceClientSecret,
        }
        setSettings(next)
        saveDriveBackupSettings(next)
      } catch {
        // The visible "server settings" button reports fetch errors when the user asks for them.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  function updateSettings(patch: Partial<DriveBackupSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveDriveBackupSettings(next)
  }

  function updateDeviceClientIdOverride(clientId: string) {
    setDeviceClientIdOverride(clientId)
    saveGoogleDriveDeviceClientIdOverride(clientId)
  }

  function updateDeviceClientSecretOverride(clientSecret: string) {
    setDeviceClientSecretOverride(clientSecret)
    saveGoogleDriveDeviceClientSecretOverride(clientSecret)
  }

  async function syncPublicConfig(options: { silent?: boolean } = {}) {
    if (!options.silent) setBusy(true)
    try {
      const config = await fetchPublicServerConfig(settings.apiBaseUrl)
      const next = {
        ...settings,
        deviceClientId: config.googleDeviceClientId || settings.deviceClientId,
        deviceClientSecret: config.googleDeviceClientSecret || settings.deviceClientSecret,
      }
      setSettings(next)
      saveDriveBackupSettings(next)
      if (!options.silent) {
        setMessage(config.googleDeviceClientId ? '서버 Google Drive 설정을 가져왔습니다.' : '서버 설정은 가져왔지만 Google Drive 값이 비어 있습니다.')
      }
    } catch (error) {
      if (!options.silent) {
        setMessage(error instanceof Error ? error.message : '서버 공개 설정을 가져오지 못했습니다.')
      }
    } finally {
      if (!options.silent) setBusy(false)
    }
  }

  async function connectDrive() {
    setBusy(true)
    setDeviceAuth(null)
    try {
      const clientId = await resolveGoogleDriveDeviceClientId(settings.apiBaseUrl)
      const clientSecret = await resolveGoogleDriveDeviceClientSecret(settings.apiBaseUrl)
      const authorization = await requestGoogleDriveDeviceAuthorization(clientId)
      setDeviceAuth({ userCode: authorization.userCode, verificationUrl: authorization.verificationUrl })
      openExternalUrl(authorization.verificationUrl)
      setMessage(`브라우저에서 Google Drive 권한을 승인해 주세요. 코드: ${authorization.userCode}`)

      const token = await pollGoogleDriveDeviceToken(
        clientId,
        clientSecret,
        authorization.deviceCode,
        authorization.interval,
        authorization.expiresIn,
      )
      if (!token.refreshToken) throw new Error('Google Drive refresh token을 받지 못했습니다.')
      await saveDriveRefreshToken(token.refreshToken)
      setConnected(true)
      setDeviceAuth(null)
      const nextFiles = await listDriveBackups(token.accessToken)
      setFiles(nextFiles)
      setSelectedFileId(nextFiles[0]?.id || '')
      setMessage('Google Drive 연결이 완료되었습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google Drive 연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function ensureAccessToken() {
    const refreshToken = await getDriveRefreshToken()
    if (!refreshToken) throw new Error('먼저 Google Drive를 연결해 주세요.')
    const clientId = await resolveGoogleDriveDeviceClientId(settings.apiBaseUrl)
    const clientSecret = await resolveGoogleDriveDeviceClientSecret(settings.apiBaseUrl)
    const token = await refreshGoogleDriveAccessToken(clientId, clientSecret, refreshToken)
    return token.accessToken
  }

  async function createLocalBackup() {
    setBusy(true)
    try {
      const result = await createBackup()
      window.localStorage.setItem('tireStore.lastBackupAt', result.createdAt)
      setMessage(`로컬 백업을 만들었습니다: ${result.backupPath}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '로컬 백업에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function uploadBackup() {
    setBusy(true)
    try {
      const uploaded = await uploadEncryptedBackup()
      setMessage(`Google Drive에 백업했습니다: ${uploaded.name}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google Drive 백업에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function uploadEncryptedBackup() {
    if (!password.trim()) throw new Error('Google Drive에는 암호화 백업만 업로드할 수 있습니다. 백업 암호를 입력해 주세요.')
    const accessToken = await ensureAccessToken()
    const payload = await exportDatabaseBackupPayload()
    const pack = await encryptBackupPayload(payload, password)
    const uploaded = await uploadEncryptedBackupToDrive(accessToken, payload.fileName, pack)
    await enforceDriveBackupRetention(accessToken, settings.retentionCount)
    const refreshed = await listDriveBackups(accessToken)
    setFiles(refreshed)
    setSelectedFileId(uploaded.id)
    if (settings.rememberPassword) {
      await saveDriveBackupPassword(password)
    } else {
      await deleteDriveBackupPassword()
    }
    markDriveBackup(payload.exportedAt)
    return uploaded
  }

  async function refreshList() {
    setBusy(true)
    try {
      const accessToken = await ensureAccessToken()
      const nextFiles = await listDriveBackups(accessToken)
      setFiles(nextFiles)
      setSelectedFileId(nextFiles[0]?.id || '')
      setMessage(`백업 ${nextFiles.length.toLocaleString('ko-KR')}개를 불러왔습니다.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google Drive 백업 목록을 불러오지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function syncDrive() {
    setBusy(true)
    try {
      const accessToken = await ensureAccessToken()
      const nextFiles = await listDriveBackups(accessToken)
      setFiles(nextFiles)
      setSelectedFileId(nextFiles[0]?.id || '')
      const decision = decideDriveSync(
        nextFiles,
        window.localStorage.getItem('tireStore.lastBackupAt') || '',
        window.localStorage.getItem('tireStore.lastDriveBackupAt') || '',
      )
      if (decision.action === 'restore_remote' && decision.latestRemote) {
        setSelectedFileId(decision.latestRemote.id)
        setMessage(decision.reason)
        return
      }
      if (decision.action === 'upload_local') {
        const uploaded = await uploadEncryptedBackup()
        setMessage(`${decision.reason} 완료: ${uploaded.name}`)
        return
      }
      setMessage(decision.reason)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google Drive 동기화에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreSelected() {
    if (!selectedFile) {
      setMessage('복원할 백업을 선택해 주세요.')
      return
    }
    const confirmed = window.confirm(`${selectedFile.name} 백업으로 현재 DB를 교체합니다. 계속할까요?`)
    if (!confirmed) return
    setBusy(true)
    try {
      const accessToken = await ensureAccessToken()
      const pack = await downloadDriveBackup(accessToken, selectedFile.id)
      const payload = await decryptBackupPackage(pack, password)
      await closeDatabase()
      const result = await restoreDatabaseFromBase64(payload.databaseBase64)
      markDriveBackup(payload.exportedAt)
      setMessage(`복원이 완료되었습니다. 기존 DB 안전 백업: ${result.backupPath}`)
      scheduleReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google Drive 백업 복원에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreLocalBackup() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Database backup', extensions: ['db', 'sqlite', 'sqlite3'] }],
    })

    if (typeof selected !== 'string') return

    const confirmed = window.confirm(`${selected} 파일로 현재 DB를 교체합니다. 계속할까요?`)
    if (!confirmed) return

    setBusy(true)
    try {
      await closeDatabase()
      const result = await restoreDatabaseFromPath(selected)
      window.localStorage.setItem('tireStore.lastBackupAt', result.createdAt)
      setMessage(`로컬 백업 복원이 완료되었습니다. 기존 DB 안전 백업: ${result.backupPath}`)
      scheduleReload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '로컬 백업 복원에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected() {
    if (!selectedFile) {
      setMessage('삭제할 백업을 선택해 주세요.')
      return
    }
    const confirmed = window.confirm(`${selectedFile.name} 백업을 Google Drive에서 삭제할까요?`)
    if (!confirmed) return
    setBusy(true)
    try {
      const accessToken = await ensureAccessToken()
      await deleteDriveBackup(accessToken, selectedFile.id)
      const nextFiles = await listDriveBackups(accessToken)
      setFiles(nextFiles)
      setSelectedFileId(nextFiles[0]?.id || '')
      setMessage('선택한 Drive 백업을 삭제했습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Drive 백업 삭제에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  function markDriveBackup(exportedAt: string) {
    window.localStorage.setItem('tireStore.lastDriveBackupAt', exportedAt)
    window.localStorage.setItem('tireStore.lastBackupAt', exportedAt)
    setLastDriveBackupAt(exportedAt)
  }

  return (
    <div className="page">
      <div className="page-heading">
        <p className="eyebrow">백업 / 복원</p>
        <h2>Google Drive 백업</h2>
        <p className="page-copy">
          요아정과 같은 기기 인증 방식으로 Google Drive에 연결하고, 암호화된 DB 백업을 Drive에 보관합니다.
        </p>
      </div>

      <section className="panel">
        <div className="panel-header-inline">
          <div>
            <h3>Drive 연결</h3>
            <p className="page-copy">
              {connected ? 'Google Drive 연결 토큰이 저장되어 있습니다.' : '서버 설정 또는 직접 입력값으로 Google Drive를 연결해 주세요.'}
            </p>
          </div>
          <button className="secondary-button" disabled={busy} type="button" onClick={() => void syncPublicConfig()}>
            서버 설정 가져오기
          </button>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>서버 주소</span>
            <input value={settings.apiBaseUrl} onChange={(event) => updateSettings({ apiBaseUrl: event.target.value })} />
          </label>
          <label className="field">
            <span>보관 개수</span>
            <input
              min={1}
              max={50}
              type="number"
              value={settings.retentionCount}
              onChange={(event) => updateSettings({ retentionCount: Number(event.target.value) || 1 })}
            />
          </label>
          <label className="field">
            <span>Google Device Client ID 직접 입력</span>
            <input value={deviceClientIdOverride} onChange={(event) => updateDeviceClientIdOverride(event.target.value)} />
          </label>
          <label className="field">
            <span>Google Device Client Secret 직접 입력</span>
            <input
              type="password"
              value={deviceClientSecretOverride}
              onChange={(event) => updateDeviceClientSecretOverride(event.target.value)}
            />
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" checked={settings.enabled} onChange={(event) => updateSettings({ enabled: event.target.checked })} />
            자동 백업 사용
          </label>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={settings.syncOnStartup}
              onChange={(event) => updateSettings({ syncOnStartup: event.target.checked })}
            />
            시작 시 Drive 확인
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" checked={settings.syncOnExit} onChange={(event) => updateSettings({ syncOnExit: event.target.checked })} />
            종료 시 Drive 백업
          </label>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={settings.rememberPassword}
              onChange={(event) => updateSettings({ rememberPassword: event.target.checked })}
            />
            백업 암호 안전 저장
          </label>
        </div>

        {deviceAuth ? (
          <div className="summary-panel">
            <div>
              <span>인증 코드</span>
              <strong>{deviceAuth.userCode}</strong>
            </div>
            <div>
              <span>인증 주소</span>
              <button className="secondary-button" type="button" onClick={() => openExternalUrl(deviceAuth.verificationUrl)}>
                인증 페이지 열기
              </button>
            </div>
          </div>
        ) : null}

        <div className="button-row">
          <button className="primary-button" disabled={busy} type="button" onClick={() => void connectDrive()}>
            Drive 연결
          </button>
          <button className="secondary-button" disabled={busy} type="button" onClick={() => void refreshList()}>
            목록 새로고침
          </button>
          <button className="secondary-button" disabled={busy} type="button" onClick={() => void syncDrive()}>
            Drive 동기화
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>백업 작업</h3>
        <div className="form-grid">
          <label className="field">
            <span>백업 암호</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <div className="summary-panel summary-panel-tight">
            <div>
              <span>마지막 Drive 백업</span>
              <strong>{lastDriveBackupAt ? new Date(lastDriveBackupAt).toLocaleString('ko-KR') : '없음'}</strong>
            </div>
          </div>
        </div>
        <div className="button-row">
          <button className="secondary-button" disabled={busy} type="button" onClick={() => void createLocalBackup()}>
            로컬 백업
          </button>
          <button className="primary-button" disabled={busy} type="button" onClick={() => void uploadBackup()}>
            Drive 백업
          </button>
          <button className="secondary-button" disabled={busy || !selectedFile} type="button" onClick={() => void restoreSelected()}>
            Drive 선택 백업 복원
          </button>
          <button className="secondary-button" disabled={busy} type="button" onClick={() => void restoreLocalBackup()}>
            로컬 백업 파일 복원
          </button>
          <button className="secondary-button" disabled={busy || !selectedFile} type="button" onClick={() => void deleteSelected()}>
            선택 삭제
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Drive 백업 목록</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>선택</th>
                <th>파일명</th>
                <th>생성일</th>
                <th>크기</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={4}>
                    백업 목록이 없습니다.
                  </td>
                </tr>
              ) : (
                files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <input checked={selectedFileId === file.id} type="radio" onChange={() => setSelectedFileId(file.id)} />
                    </td>
                    <td>{file.name}</td>
                    <td>{new Date(file.createdTime).toLocaleString('ko-KR')}</td>
                    <td>{file.size ? `${Math.ceil(file.size / 1024).toLocaleString('ko-KR')} KB` : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>결과</h3>
        <pre className="result-box">{busy ? '작업 중입니다...' : message}</pre>
      </section>
    </div>
  )
}

function openExternalUrl(url: string) {
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    // Ignore blocked popups; the visible code and URL remain on screen.
  }
}

function scheduleReload() {
  window.setTimeout(() => {
    window.location.reload()
  }, 900)
}
