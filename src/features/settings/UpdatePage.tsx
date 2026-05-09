import { useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { showErrorDialog } from '../../lib/dialogs'
import {
  APP_VERSION,
  DEFAULT_BILLING_SERVER_BASE_URL,
  checkForLicenseServerUpdates,
  loadBillingPreferences,
  saveBillingPreferences,
  type UpdateCheckResult,
} from './licenseService'
import {
  checkTauriUpdater,
  downloadInstallAndRelaunch,
  isTauriRuntime,
  type TauriUpdaterProgress,
  type TauriUpdaterStatus,
} from './updateService'

export function UpdatePage() {
  const [serverBaseUrl, setServerBaseUrl] = useState(DEFAULT_BILLING_SERVER_BASE_URL)
  const [channel, setChannel] = useState('stable')
  const [currentVersion, setCurrentVersion] = useState(APP_VERSION)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [tauriStatus, setTauriStatus] = useState<TauriUpdaterStatus | null>(null)
  const [progress, setProgress] = useState<TauriUpdaterProgress | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [status, setStatus] = useState('업데이트 서버를 확인할 준비가 되었습니다.')

  async function handleCheckUpdates() {
    try {
      setChecking(true)
      setProgress(null)
      setStatus('업데이트를 확인하는 중입니다.')
      const preferences = await loadBillingPreferences()
      const nextCurrentVersion = await resolveCurrentVersion()
      const nextServerBaseUrl = preferences.serverBaseUrl || serverBaseUrl || DEFAULT_BILLING_SERVER_BASE_URL
      setCurrentVersion(nextCurrentVersion)
      setServerBaseUrl(nextServerBaseUrl)
      await saveBillingPreferences({ ...preferences, serverBaseUrl: nextServerBaseUrl })

      const serverUpdate = await checkForLicenseServerUpdates(nextServerBaseUrl, channel, nextCurrentVersion)
      setResult(serverUpdate)

      if (channel === 'stable') {
        const updater = await checkTauriUpdater()
        setTauriStatus(updater)
        setStatus(updateMessage(serverUpdate, updater))
        return
      }

      setTauriStatus(null)
      setStatus(
        serverUpdate.updateAvailable
          ? `새 버전 ${serverUpdate.version}이 있습니다. ${channel} 채널은 수동 다운로드로 설치해 주세요.`
          : '현재 최신 버전입니다.',
      )
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : '업데이트 확인에 실패했습니다.'
      setStatus(message)
      await showErrorDialog(error, '업데이트 확인 실패')
    } finally {
      setChecking(false)
    }
  }

  async function handleInstallOrDownload() {
    if (!hasInstallableUpdate && result?.url) {
      window.open(result.url, '_blank', 'noopener,noreferrer')
      return
    }

    try {
      setInstalling(true)
      setProgress(null)
      setStatus('업데이트를 다운로드하고 설치하는 중입니다.')
      await downloadInstallAndRelaunch(setProgress)
    } catch (error) {
      console.error(error)
      setInstalling(false)
      const message = error instanceof Error ? error.message : '자동 업데이트 설치에 실패했습니다.'
      setStatus(`${message} 수동 다운로드로 설치해 주세요.`)
      await showErrorDialog(error, '업데이트 설치 실패')
    }
  }

  const latestVersion = result?.version ?? tauriStatus?.version ?? '-'
  const hasServerUpdate = Boolean(result?.updateAvailable)
  const hasInstallableUpdate = Boolean(tauriStatus?.supported && tauriStatus.updateAvailable && channel === 'stable')
  const canInstallOrDownload = hasInstallableUpdate || Boolean(hasServerUpdate && result?.url)
  const statusLabel = hasInstallableUpdate ? '자동 설치 가능' : hasServerUpdate ? '다운로드 가능' : result ? '최신' : '확인 전'
  const progressLabel = progress?.percent == null ? '' : ` ${progress.percent}%`

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">업데이트</p>
          <h2>프로그램 업데이트</h2>
          <p className="page-copy">
            Litire 서버에 등록된 배포 정보를 확인하고, 서명된 stable 업데이트는 프로그램 안에서 바로 설치합니다.
          </p>
        </div>
        <div className="status-pill">{statusLabel}</div>
      </header>

      <section className="content-grid content-grid-wide">
        <article className="panel">
          <div className="panel-header-inline">
            <div>
              <h3>업데이트 확인</h3>
              <p className="page-copy">서버 주소와 채널을 선택한 뒤 최신 배포를 확인합니다.</p>
            </div>
          </div>

          <div className="form-grid">
            <label className="field field-wide">
              <span>업데이트 서버 URL</span>
              <input onChange={(event) => setServerBaseUrl(event.target.value)} value={serverBaseUrl} />
            </label>
            <label className="field">
              <span>채널</span>
              <select className="field-select" onChange={(event) => setChannel(event.target.value)} value={channel}>
                <option value="stable">stable</option>
                <option value="beta">beta</option>
              </select>
            </label>
          </div>

          <div className="button-row">
            <button className="secondary-button" disabled={checking || installing} onClick={handleCheckUpdates} type="button">
              {checking ? '확인 중...' : '업데이트 확인'}
            </button>
            <button className="primary-button" disabled={!canInstallOrDownload || installing} onClick={handleInstallOrDownload} type="button">
              {installing ? `설치 중${progressLabel}` : hasInstallableUpdate ? '자동 설치' : '설치 파일 받기'}
            </button>
            {result?.url ? (
              <a className="secondary-button" href={result.url} rel="noreferrer" target="_blank">
                수동 다운로드
              </a>
            ) : null}
          </div>

          <div className="note-box">
            <strong>{status}</strong>
            <p>현재 버전: {formatDisplayVersion(currentVersion)}</p>
            <p>서버 최신 버전: {formatDisplayVersion(latestVersion)}</p>
            <p>자동 설치: {isTauriRuntime() ? (tauriStatus?.message ?? '아직 확인하지 않았습니다.') : '브라우저 미리보기에서는 사용할 수 없습니다.'}</p>
          </div>
        </article>

        <article className="panel">
          <h3>배포 정보</h3>
          <dl className="info-list">
            <div>
              <dt>채널</dt>
              <dd>{result?.channel ?? channel}</dd>
            </div>
            <div>
              <dt>게시일</dt>
              <dd>{tauriStatus?.date?.slice(0, 10) ?? result?.pubDate?.slice(0, 10) ?? '-'}</dd>
            </div>
            <div>
              <dt>서명</dt>
              <dd>{result?.signature ? '있음' : '없음'}</dd>
            </div>
            <div>
              <dt>설치 방식</dt>
              <dd>{hasInstallableUpdate ? '앱 안에서 다운로드 후 재시작' : hasServerUpdate ? '설치 파일 다운로드' : '확인 대기'}</dd>
            </div>
            <div>
              <dt>파일</dt>
              <dd>{result?.fileName ?? '-'}</dd>
            </div>
            <div>
              <dt>배포 메모</dt>
              <dd>{tauriStatus?.body ?? result?.notes ?? '-'}</dd>
            </div>
          </dl>
        </article>
      </section>
    </section>
  )
}

function formatDisplayVersion(version: string) {
  return version === '-' ? version : version.replace(/\.0$/, '')
}

async function resolveCurrentVersion() {
  if (!isTauriRuntime()) return APP_VERSION
  try {
    return await getVersion()
  } catch {
    return APP_VERSION
  }
}

function updateMessage(serverUpdate: UpdateCheckResult, updater: TauriUpdaterStatus) {
  if (updater.updateAvailable) return updater.message
  if (!serverUpdate.updateAvailable) return updater.message
  if (!updater.supported) return `새 버전 ${serverUpdate.version}이 있습니다. 수동 다운로드로 설치해 주세요.`
  return `새 버전 ${serverUpdate.version}이 서버에 있지만 자동 설치 검증이 실패했습니다. 수동 다운로드로 설치해 주세요. 원인: ${updater.message}`
}
