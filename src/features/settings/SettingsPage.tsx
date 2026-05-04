import { useEffect, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { selectRows } from '../../lib/db'
import { createBackupAt, getRuntimeInfo, refreshRuntimeReady } from '../../lib/desktop'
import { showErrorDialog, showValidationDialog } from '../../lib/dialogs'
import { ensureReferenceData, getReferenceDataSummary } from '../../lib/referenceData'
import type {
  BackupLogRow,
  BackupPreferences,
  BillingPlanCode,
  BillingPreferences,
  BrandDiscountRule,
  LicenseStatus,
  ProductDiscountRule,
  PublicQuotePreferences,
  ReferenceDataSummary,
  TestBillingCheckoutInput,
  RuntimeInfo,
} from '../../lib/types'
import { publishPublicQuoteFeed } from '../publicQuote/publicQuotePublishingService'
import {
  DEFAULT_PUBLIC_QUOTE_NOTICE,
  DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL,
  DEFAULT_PUBLIC_QUOTE_SERVICE_AREA,
  DEFAULT_PUBLIC_QUOTE_STORE_NAME,
} from '../publicQuote/quoteUtils'
import {
  loadBackupPreferences,
  loadBrandDiscountRules,
  loadProductDiscountRules,
  loadPublicQuotePreferences,
  saveBackupPreferences,
  saveBrandDiscountRules,
  saveProductDiscountRules,
  savePublicQuotePreferences,
} from './settingsService'
import {
  BILLING_PLANS,
  DEFAULT_BILLING_SERVER_BASE_URL,
  DEFAULT_DEVICE_NAME,
  activateBillingLicense,
  checkForLicenseServerUpdates,
  createBillingCheckoutSession,
  createFallbackLicenseStatus,
  ensureBillingDeviceId,
  fetchBillingLicenseStatus,
  isLicenseBlocking,
  isLicenseUsable,
  loadBillingPreferences,
  notifyLicenseStatusUpdated,
  saveBillingPreferences,
  type UpdateCheckResult,
} from './licenseService'
import {
  checkTauriUpdater,
  downloadInstallAndRelaunch,
  type TauriUpdaterProgress,
  type TauriUpdaterStatus,
} from './updateService'

const defaultBackupPreferences: BackupPreferences = {
  googleDriveAccountEmail: '',
  backupFolderPath: '',
  autoBackupEnabled: false,
  autoBackupMemo: '',
  lowStockThreshold: 4,
}

const defaultReferenceSummary: ReferenceDataSummary = {
  tireBrandCount: 0,
  vehicleBrandCount: 0,
  vehicleModelCount: 0,
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

const defaultTestBillingCheckoutInput: TestBillingCheckoutInput = {
  storeName: '',
  ownerName: '',
  phone: '',
  planCode: 'monthly',
}

function createBackupFileName() {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')

  return `tire-store-backup-${stamp}.db`
}

function joinPath(basePath: string, fileName: string) {
  if (!basePath.trim()) {
    return fileName
  }

  const separator = basePath.includes('\\') ? '\\' : '/'
  const normalizedBase = basePath.replace(/[\\/]+$/, '')
  return `${normalizedBase}${separator}${fileName}`
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '-'
  }

  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return value
  }

  return new Date(parsed).toLocaleString('ko-KR')
}

function normalizeMoneyInput(value: string) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, Math.round(numeric))
}

function normalizeDiscountRate(value: string) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100))
}

function formatMoney(value: number) {
  return `${Math.max(0, Math.round(value)).toLocaleString('ko-KR')}원`
}

function getLicenseStatusLabel(status: LicenseStatus['status']) {
  switch (status) {
    case 'active':
      return '정상 사용'
    case 'grace':
      return '유예 기간'
    case 'expired':
      return '만료'
    case 'suspended':
      return '중지'
    default:
      return '미활성'
  }
}

async function loadRecentBackups() {
  return selectRows<BackupLogRow>(
    `SELECT
      id AS id,
      backup_path AS backupPath,
      backup_type AS backupType,
      created_at AS createdAt,
      COALESCE(note, '') AS note
    FROM backups
    ORDER BY id DESC
    LIMIT 10`,
  )
}

export function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [status, setStatus] = useState('설정 정보를 불러오는 중입니다.')
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [referenceSummary, setReferenceSummary] = useState<ReferenceDataSummary>(defaultReferenceSummary)
  const [backupPreferences, setBackupPreferences] = useState<BackupPreferences>(defaultBackupPreferences)
  const [brandRules, setBrandRules] = useState<BrandDiscountRule[]>([])
  const [productRules, setProductRules] = useState<ProductDiscountRule[]>([])
  const [publicQuotePreferences, setPublicQuotePreferences] =
    useState<PublicQuotePreferences>(defaultPublicQuotePreferences)
  const [billingPreferences, setBillingPreferences] = useState<BillingPreferences>(defaultBillingPreferences)
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus>(
    createFallbackLicenseStatus('라이선스 서버를 아직 연결하지 않았습니다.'),
  )
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [tauriUpdateStatus, setTauriUpdateStatus] = useState<TauriUpdaterStatus | null>(null)
  const [updateProgress, setUpdateProgress] = useState<TauriUpdaterProgress | null>(null)
  const [testCheckoutInput, setTestCheckoutInput] = useState<TestBillingCheckoutInput>(defaultTestBillingCheckoutInput)
  const [recentBackups, setRecentBackups] = useState<BackupLogRow[]>([])

  useEffect(() => {
    let active = true

    async function loadPage() {
      try {
        const [
          nextBackupPreferences,
          nextBillingPreferences,
          nextBrandRules,
          nextProductRules,
          nextPublicQuotePreferences,
          nextRuntimeInfo,
          nextReferenceSummary,
          nextRecentBackups,
        ] = await Promise.all([
          loadBackupPreferences(),
          loadBillingPreferences(),
          loadBrandDiscountRules(),
          loadProductDiscountRules(),
          loadPublicQuotePreferences(),
          getRuntimeInfo(),
          getReferenceDataSummary(),
          loadRecentBackups(),
        ])

        if (!active) {
          return
        }

        setBackupPreferences(nextBackupPreferences)
        setBillingPreferences(nextBillingPreferences)
        setLicenseStatus(
          nextBillingPreferences.cachedStatus ?? createFallbackLicenseStatus('라이선스 정보를 아직 확인하지 않았습니다.'),
        )
        setBrandRules(nextBrandRules)
        setProductRules(nextProductRules)
        setPublicQuotePreferences(nextPublicQuotePreferences)
        setRuntimeInfo(nextRuntimeInfo)
        setReferenceSummary(nextReferenceSummary)
        setRecentBackups(nextRecentBackups)
        setStatus('설정 화면이 준비되었습니다.')
      } catch (error) {
        console.error(error)
        if (!active) {
          return
        }

        setStatus(error instanceof Error ? error.message : '설정 정보를 불러오지 못했습니다.')
        await showErrorDialog(error, '설정 불러오기 실패')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadPage()

    return () => {
      active = false
    }
  }, [])

  async function refreshRuntimeSummary() {
    const [
      nextRuntimeInfo,
      nextReferenceSummary,
      nextRecentBackups,
      nextPublicQuotePreferences,
      nextBillingPreferences,
    ] = await Promise.all([
      getRuntimeInfo(),
      getReferenceDataSummary(),
      loadRecentBackups(),
      loadPublicQuotePreferences(),
      loadBillingPreferences(),
    ])

    setRuntimeInfo(nextRuntimeInfo)
    setReferenceSummary(nextReferenceSummary)
    setRecentBackups(nextRecentBackups)
    setPublicQuotePreferences(nextPublicQuotePreferences)
    setBillingPreferences(nextBillingPreferences)
    setLicenseStatus(
      nextBillingPreferences.cachedStatus ?? createFallbackLicenseStatus('라이선스 정보를 아직 확인하지 않았습니다.'),
    )
  }

  function updateBackupPreferences<Key extends keyof BackupPreferences>(key: Key, value: BackupPreferences[Key]) {
    setBackupPreferences((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updatePublicQuotePreferences<Key extends keyof PublicQuotePreferences>(
    key: Key,
    value: PublicQuotePreferences[Key],
  ) {
    setPublicQuotePreferences((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updateBillingPreferences<Key extends keyof BillingPreferences>(key: Key, value: BillingPreferences[Key]) {
    setBillingPreferences((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updateTestCheckoutInput<Key extends keyof TestBillingCheckoutInput>(
    key: Key,
    value: TestBillingCheckoutInput[Key],
  ) {
    setTestCheckoutInput((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updateBrandRule(index: number, field: keyof BrandDiscountRule, value: string) {
    setBrandRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index
          ? {
              ...rule,
              [field]: field === 'discountRate' ? normalizeDiscountRate(value) : value,
            }
          : rule,
      ),
    )
  }

  function updateProductRule(index: number, field: keyof ProductDiscountRule, value: string) {
    setProductRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index
          ? {
              ...rule,
              [field]: field === 'discountRate' ? normalizeDiscountRate(value) : value,
            }
          : rule,
      ),
    )
  }

  function addBrandRule() {
    setBrandRules((current) => [...current, { brandName: '', discountRate: 0 }])
  }

  function addProductRule() {
    setProductRules((current) => [...current, { productName: '', discountRate: 0 }])
  }

  function removeBrandRule(index: number) {
    setBrandRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))
  }

  function removeProductRule(index: number) {
    setProductRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))
  }

  async function handleBrowseBackupFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: backupPreferences.backupFolderPath || undefined,
    })

    if (typeof selected === 'string') {
      updateBackupPreferences('backupFolderPath', selected)
      setStatus('백업 폴더를 선택했습니다. 저장하면 기본 경로로 사용됩니다.')
    }
  }

  async function handleQuickFolderBackup() {
    try {
      let folderPath = backupPreferences.backupFolderPath.trim()
      if (!folderPath) {
        const selected = await open({
          directory: true,
          multiple: false,
        })

        if (typeof selected !== 'string' || !selected.trim()) {
          return
        }

        folderPath = selected
        updateBackupPreferences('backupFolderPath', folderPath)
      }

      const destinationPath = joinPath(folderPath, createBackupFileName())
      const backup = await createBackupAt(destinationPath)
      await refreshRuntimeSummary()
      setStatus(`폴더 백업을 완료했습니다. ${backup.backupPath}`)
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '폴더 백업에 실패했습니다.')
      await showErrorDialog(error, '폴더 백업 실패')
    }
  }

  async function handleSaveBackupAs() {
    try {
      const selected = await save({
        defaultPath: joinPath(backupPreferences.backupFolderPath || '.', createBackupFileName()),
        filters: [{ name: 'Database backup', extensions: ['db'] }],
      })

      if (!selected) {
        return
      }

      const backup = await createBackupAt(selected)
      await refreshRuntimeSummary()
      setStatus(`다른 이름으로 백업을 저장했습니다. ${backup.backupPath}`)
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '백업 저장에 실패했습니다.')
      await showErrorDialog(error, '백업 저장 실패')
    }
  }

  async function handleRepairRuntimeData() {
    try {
      setRepairing(true)
      await refreshRuntimeReady()
      await ensureReferenceData()
      await refreshRuntimeSummary()
      setStatus('런타임 점검과 기준 데이터 보정을 완료했습니다.')
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '런타임 점검에 실패했습니다.')
      await showErrorDialog(error, '런타임 점검 실패')
    } finally {
      setRepairing(false)
    }
  }

  async function handleCreateBillingCheckout() {
    const issues: string[] = []

    if (!testCheckoutInput.storeName.trim()) {
      issues.push('매장명을 입력해 주세요.')
    }
    if (!testCheckoutInput.ownerName.trim()) {
      issues.push('대표자명을 입력해 주세요.')
    }
    if (!testCheckoutInput.phone.trim()) {
      issues.push('연락처를 입력해 주세요.')
    }

    if (billingPreferences.checkoutMode === 'toss' && !billingPreferences.tossClientKey.trim()) {
      issues.push('토스 테스트 클라이언트 키를 입력해 주세요.')
    }
    if (billingPreferences.checkoutMode === 'toss' && !billingPreferences.tossSecretKey.trim()) {
      issues.push('토스 테스트 시크릿 키를 입력해 주세요.')
    }

    if (issues.length > 0) {
      await showValidationDialog(issues, '결제 페이지 생성')
      return
    }

    try {
      setBillingBusy(true)
      const ensuredPreferences = await ensureBillingDeviceId(billingPreferences)
      const { preferences: nextPreferences, session } = await createBillingCheckoutSession(ensuredPreferences, {
        ...testCheckoutInput,
        mode: ensuredPreferences.checkoutMode,
        tossClientKey: ensuredPreferences.tossClientKey,
        tossSecretKey: ensuredPreferences.tossSecretKey,
      })
      setBillingPreferences(nextPreferences)
      setLicenseStatus(session.status)
      notifyLicenseStatusUpdated()
      window.open(session.checkoutUrl, '_blank', 'noopener,noreferrer')
      setStatus(`결제 페이지를 열었습니다. 매장 코드 ${session.storeCode} / 활성화 코드를 확인해 주세요.`)
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '결제 페이지 생성에 실패했습니다.')
      await showErrorDialog(error, '결제 페이지 생성 실패')
    } finally {
      setBillingBusy(false)
    }
  }

  /* async function handleCreateTestBillingCheckout() {
    const issues: string[] = []

    if (!testCheckoutInput.storeName.trim()) {
      issues.push('테스트 결제용 매장명을 입력해 주세요.')
    }
    if (!testCheckoutInput.ownerName.trim()) {
      issues.push('대표자명을 입력해 주세요.')
    }
    if (!testCheckoutInput.phone.trim()) {
      issues.push('연락처를 입력해 주세요.')
    }

    if (issues.length > 0) {
      await showValidationDialog(issues, '테스트 결제 생성')
      return
    }

    try {
      setBillingBusy(true)
      const result = await createTestBillingCheckout(billingPreferences.serverBaseUrl, testCheckoutInput)
      const nextPreferences = await saveBillingPreferences({
        ...billingPreferences,
        storeCode: result.storeCode,
        activationCode: result.activationCode,
        cachedStatus: result.status,
        lastVerifiedAt: new Date().toISOString(),
      })
      setBillingPreferences(nextPreferences)
      setLicenseStatus(result.status)
      notifyLicenseStatusUpdated()
      setStatus(`테스트 결제를 만들었습니다. 매장 코드 ${result.storeCode} / 활성화 코드를 확인해 주세요.`)
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '테스트 결제 생성에 실패했습니다.')
      await showErrorDialog(error, '테스트 결제 생성 실패')
    } finally {
      setBillingBusy(false)
    }
  } */

  async function handleActivateBillingLicense() {
    const issues: string[] = []

    if (!billingPreferences.serverBaseUrl.trim()) {
      issues.push('라이선스 서버 주소를 입력해 주세요.')
    }
    if (!billingPreferences.storeCode.trim()) {
      issues.push('매장 코드를 입력해 주세요.')
    }
    if (!billingPreferences.activationCode.trim()) {
      issues.push('활성화 코드를 입력해 주세요.')
    }

    if (issues.length > 0) {
      await showValidationDialog(issues, '라이선스 활성화')
      return
    }

    try {
      setBillingBusy(true)
      const ensuredPreferences = await ensureBillingDeviceId(billingPreferences)
      setBillingPreferences(ensuredPreferences)
      const result = await activateBillingLicense(ensuredPreferences)
      setBillingPreferences(result.preferences)
      setLicenseStatus(result.status)
      notifyLicenseStatusUpdated()
      setStatus(result.status.message)
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '라이선스 활성화에 실패했습니다.')
      await showErrorDialog(error, '라이선스 활성화 실패')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handleRefreshBillingLicenseStatus() {
    if (!billingPreferences.serverBaseUrl.trim() || !billingPreferences.storeCode.trim()) {
      await showValidationDialog(['라이선스 서버 주소와 매장 코드를 먼저 입력해 주세요.'], '라이선스 상태 확인')
      return
    }

    try {
      setBillingBusy(true)
      const ensuredPreferences = await ensureBillingDeviceId(billingPreferences)
      setBillingPreferences(ensuredPreferences)
      const result = await fetchBillingLicenseStatus(ensuredPreferences)
      setBillingPreferences(result.preferences)
      setLicenseStatus(result.status)
      notifyLicenseStatusUpdated()
      setStatus(result.status.message)
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '라이선스 상태 확인에 실패했습니다.')
      await showErrorDialog(error, '라이선스 상태 확인 실패')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handleCheckUpdates() {
    try {
      setUpdateBusy(true)
      setStatus('업데이트를 확인하는 중입니다.')
      const [serverUpdate, updaterStatus] = await Promise.all([
        checkForLicenseServerUpdates(billingPreferences.serverBaseUrl || DEFAULT_BILLING_SERVER_BASE_URL),
        checkTauriUpdater(),
      ])
      setUpdateResult(serverUpdate)
      setTauriUpdateStatus(updaterStatus)
      setStatus(
        updaterStatus.updateAvailable
          ? updaterStatus.message
          : serverUpdate.updateAvailable
            ? `새 버전 ${serverUpdate.version}이 있습니다.`
            : '현재 최신 버전입니다.',
      )
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '업데이트 확인에 실패했습니다.')
      await showErrorDialog(error, '업데이트 확인 실패')
    } finally {
      setUpdateBusy(false)
    }
  }

  async function handleInstallUpdate() {
    try {
      setInstallingUpdate(true)
      setUpdateProgress(null)
      setStatus('업데이트를 다운로드하고 설치하는 중입니다.')
      await downloadInstallAndRelaunch(setUpdateProgress)
    } catch (error) {
      console.error(error)
      setInstallingUpdate(false)
      setStatus(error instanceof Error ? error.message : '업데이트 설치에 실패했습니다.')
      await showErrorDialog(error, '업데이트 설치 실패')
    }
  }

  async function handleSaveAllSettings() {
    try {
      setSaving(true)
      const [savedBrandRules, savedProductRules, savedPublicQuotePreferences] = await Promise.all([
        saveBrandDiscountRules(brandRules),
        saveProductDiscountRules(productRules),
        savePublicQuotePreferences(publicQuotePreferences),
      ])

      await saveBackupPreferences(backupPreferences)
      const savedBillingPreferences = await saveBillingPreferences(billingPreferences)
      setBrandRules(savedBrandRules)
      setProductRules(savedProductRules)
      setPublicQuotePreferences(savedPublicQuotePreferences)
      setBillingPreferences(savedBillingPreferences)
      notifyLicenseStatusUpdated()
      await refreshRuntimeSummary()
      setStatus('설정을 저장했습니다.')
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '설정 저장에 실패했습니다.')
      await showErrorDialog(error, '설정 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handlePublishQuoteFeed() {
    if (!publicQuotePreferences.enabled) {
      await showValidationDialog(['공개 견적 발행을 먼저 켜 주세요.'], '공개 견적 발행')
      return
    }

    if (!publicQuotePreferences.publishEndpoint.trim()) {
      await showValidationDialog(['발행 엔드포인트를 입력해 주세요.'], '공개 견적 발행')
      return
    }

    try {
      setPublishing(true)
      const savedPreferences = await savePublicQuotePreferences(publicQuotePreferences)
      const feed = await publishPublicQuoteFeed(savedPreferences)
      setPublicQuotePreferences((current) => ({
        ...current,
        lastPublishedAt: feed.lastPublishedAt,
        lastPublishError: '',
      }))
      await refreshRuntimeSummary()
      setStatus(`공개 견적 피드를 발행했습니다. 상품 ${feed.items.length.toLocaleString('ko-KR')}건`)
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : '공개 견적 발행에 실패했습니다.'
      setPublicQuotePreferences((current) => ({
        ...current,
        lastPublishError: message,
      }))
      setStatus(message)
      await showErrorDialog(error, '공개 견적 발행 실패')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">설정</p>
          <h2>운영 설정</h2>
          <p className="page-copy">
            백업, 할인 규칙, 공개 견적 발행, 기준 데이터 상태를 한 화면에서 관리합니다.
          </p>
        </div>
        <div className="status-pill">{loading ? '설정 로딩 중' : status}</div>
      </header>

      <section className="content-grid content-grid-wide">
        <article className="panel">
          <div className="panel-header-inline">
            <div>
              <h3>라이선스 서버 업데이트</h3>
              <p className="page-copy">
                litire.h19h19.synology.me에 올린 배포 정보를 확인하고, 서명된 업데이트가 있으면 자동 설치합니다.
              </p>
            </div>
            <div className="status-pill">
              {tauriUpdateStatus?.updateAvailable || updateResult?.updateAvailable ? '업데이트 있음' : '확인 대기'}
            </div>
          </div>

          <div className="button-row">
            <button className="secondary-button" disabled={updateBusy || installingUpdate} onClick={handleCheckUpdates} type="button">
              {updateBusy ? '확인 중...' : '업데이트 확인'}
            </button>
            <button
              className="primary-button"
              disabled={!tauriUpdateStatus?.updateAvailable || installingUpdate}
              onClick={handleInstallUpdate}
              type="button"
            >
              {installingUpdate
                ? `설치 중${updateProgress?.percent == null ? '' : ` ${updateProgress.percent}%`}`
                : '자동 설치'}
            </button>
            {updateResult?.url ? (
              <a className="secondary-button" href={updateResult.url} rel="noreferrer" target="_blank">
                수동 다운로드
              </a>
            ) : null}
          </div>

          <div className="note-box">
            <p>현재 버전: 1.5.0</p>
            <p>서버 최신 버전: {updateResult?.version ?? '-'}</p>
            <p>자동 업데이트: {tauriUpdateStatus?.message ?? '아직 확인하지 않았습니다.'}</p>
            <p>배포 메모: {tauriUpdateStatus?.body ?? updateResult?.notes ?? '-'}</p>
          </div>
        </article>
      </section>

      <section className="content-grid content-grid-wide">
        <article className="panel">
          <h3>백업 설정</h3>
          <div className="form-grid">
            <label className="field field-wide">
              <span>기본 백업 폴더</span>
              <div className="inline-field">
                <input
                  onChange={(event) => updateBackupPreferences('backupFolderPath', event.target.value)}
                  value={backupPreferences.backupFolderPath}
                />
                <button className="secondary-button" onClick={handleBrowseBackupFolder} type="button">
                  폴더 선택
                </button>
              </div>
            </label>

            <label className="field">
              <span>Google 계정 메모</span>
              <input
                onChange={(event) => updateBackupPreferences('googleDriveAccountEmail', event.target.value)}
                placeholder="backup@example.com"
                value={backupPreferences.googleDriveAccountEmail}
              />
            </label>

            <label className="field">
              <span>저재고 기준</span>
              <input
                min={0}
                onChange={(event) =>
                  updateBackupPreferences('lowStockThreshold', Math.max(0, Math.floor(Number(event.target.value || 0))))
                }
                type="number"
                value={backupPreferences.lowStockThreshold}
              />
            </label>

            <label className="field checkbox-field">
              <span>자동 백업</span>
              <label className="checkbox-inline">
                <input
                  checked={backupPreferences.autoBackupEnabled}
                  onChange={(event) => updateBackupPreferences('autoBackupEnabled', event.target.checked)}
                  type="checkbox"
                />
                <span>자동 백업 메모를 함께 저장합니다.</span>
              </label>
            </label>

            <label className="field field-wide">
              <span>자동 백업 메모</span>
              <input
                onChange={(event) => updateBackupPreferences('autoBackupMemo', event.target.value)}
                placeholder="예: 마감 후 자동 백업"
                value={backupPreferences.autoBackupMemo}
              />
            </label>
          </div>

          <div className="button-row">
            <button className="secondary-button" onClick={handleQuickFolderBackup} type="button">
              폴더에 바로 백업
            </button>
            <button className="secondary-button" onClick={handleSaveBackupAs} type="button">
              다른 이름으로 저장
            </button>
          </div>
        </article>

        <article className="panel">
          <h3>런타임 상태</h3>
          <dl className="info-list">
            <div>
              <dt>DB 경로</dt>
              <dd>{runtimeInfo?.dbPath ?? '-'}</dd>
            </div>
            <div>
              <dt>앱 설정 폴더</dt>
              <dd>{runtimeInfo?.appConfigDir ?? '-'}</dd>
            </div>
            <div>
              <dt>기본 백업 폴더</dt>
              <dd>{runtimeInfo?.backupDir ?? '-'}</dd>
            </div>
            <div>
              <dt>타이어 브랜드 기준</dt>
              <dd>{referenceSummary.tireBrandCount.toLocaleString('ko-KR')}건</dd>
            </div>
            <div>
              <dt>차량 브랜드 기준</dt>
              <dd>{referenceSummary.vehicleBrandCount.toLocaleString('ko-KR')}건</dd>
            </div>
            <div>
              <dt>차량 모델 기준</dt>
              <dd>{referenceSummary.vehicleModelCount.toLocaleString('ko-KR')}건</dd>
            </div>
          </dl>

          <div className="button-row">
            <button className="secondary-button" disabled={repairing} onClick={handleRepairRuntimeData} type="button">
              {repairing ? '점검 중...' : '런타임 다시 점검'}
            </button>
            <button className="primary-button" disabled={saving} onClick={handleSaveAllSettings} type="button">
              {saving ? '저장 중...' : '설정 모두 저장'}
            </button>
          </div>
        </article>
      </section>

      <section className="content-grid content-grid-wide">
        <article className="panel">
          <div className="panel-header-inline">
            <div>
              <h3>라이선스 / 결제 테스트</h3>
              <p className="page-copy">
                사업자 등록 전에는 테스트 서버로 월간/연간 플랜과 활성화 코드를 먼저 검증할 수 있습니다.
              </p>
            </div>
            <div className="status-pill">
              {getLicenseStatusLabel(licenseStatus.status)}
              {licenseStatus.isTestMode ? ' · 테스트' : ''}
            </div>
          </div>

          <div className="form-grid">
            <label className="field field-wide">
              <span>라이선스 서버 주소</span>
              <input
                onChange={(event) => updateBillingPreferences('serverBaseUrl', event.target.value)}
                placeholder="http://127.0.0.1:4175"
                value={billingPreferences.serverBaseUrl}
              />
            </label>

            <label className="field">
              <span>매장 코드</span>
              <input
                onChange={(event) => updateBillingPreferences('storeCode', event.target.value)}
                placeholder="STORE-XXXXXX"
                value={billingPreferences.storeCode}
              />
            </label>

            <label className="field">
              <span>활성화 코드</span>
              <input
                onChange={(event) => updateBillingPreferences('activationCode', event.target.value)}
                placeholder="LIC-XXXXXXXX"
                value={billingPreferences.activationCode}
              />
            </label>

            <label className="field">
              <span>기기 이름</span>
              <input
                onChange={(event) => updateBillingPreferences('deviceName', event.target.value)}
                placeholder="매장PC"
                value={billingPreferences.deviceName}
              />
            </label>

            <label className="field">
              <span>기기 ID</span>
              <input readOnly value={billingPreferences.deviceId || '활성화 시 자동 발급'} />
            </label>
          </div>

          <div className="button-row">
            <button className="secondary-button" disabled={billingBusy} onClick={handleRefreshBillingLicenseStatus} type="button">
              {billingBusy ? '확인 중..' : '라이선스 상태 확인'}
            </button>
            <button className="primary-button" disabled={billingBusy} onClick={handleActivateBillingLicense} type="button">
              {billingBusy ? '활성화 중..' : '라이선스 활성화'}
            </button>
          </div>

          <div className="note-box">
            <strong>{licenseStatus.storeName || '아직 활성화되지 않았습니다.'}</strong>
            <p>안내: {licenseStatus.message}</p>
            <p>
              상태 요약:{' '}
              {isLicenseBlocking(licenseStatus)
                ? '현재 만료/미활성 상태라 판매, 재고, 고객 화면 사용이 제한됩니다.'
                : isLicenseUsable(licenseStatus)
                  ? '정상 사용 상태입니다.'
                  : '서버 연결 전 준비 상태입니다.'}
            </p>
            <p>
              플랜: {licenseStatus.planName || '-'} / 다음 결제일: {formatDateTime(licenseStatus.nextBillingAt)}
            </p>
            <p>
              만료일: {formatDateTime(licenseStatus.expiresAt)} / 유예 종료: {formatDateTime(licenseStatus.graceUntil)}
            </p>
            <p>
              사용 기기: {licenseStatus.registeredDeviceCount} / {licenseStatus.deviceLimit}대
              {billingPreferences.lastVerifiedAt ? ` / 마지막 확인 ${formatDateTime(billingPreferences.lastVerifiedAt)}` : ''}
            </p>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header-inline">
            <div>
              <h3>테스트 플랜 생성</h3>
              <p className="page-copy">
                첫 결제와 활성화 코드 발급 흐름을 먼저 연습합니다. 실제 토스 결제는 다음 단계에서 이 서버 엔드포인트에 연결합니다.
              </p>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>매장명</span>
              <input
                onChange={(event) => updateTestCheckoutInput('storeName', event.target.value)}
                placeholder="예: 맥스타드 타이어"
                value={testCheckoutInput.storeName}
              />
            </label>

            <label className="field">
              <span>대표자명</span>
              <input
                onChange={(event) => updateTestCheckoutInput('ownerName', event.target.value)}
                placeholder="예: 홍길동"
                value={testCheckoutInput.ownerName}
              />
            </label>

            <label className="field">
              <span>연락처</span>
              <input
                onChange={(event) => updateTestCheckoutInput('phone', event.target.value)}
                placeholder="010-0000-0000"
                value={testCheckoutInput.phone}
              />
            </label>

            <label className="field">
              <span>플랜</span>
              <select
                className="field-select"
                onChange={(event) => updateTestCheckoutInput('planCode', event.target.value as BillingPlanCode)}
                value={testCheckoutInput.planCode}
              >
                {BILLING_PLANS.map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="billing-plan-grid">
            {BILLING_PLANS.map((plan) => (
              <article className="billing-plan-card" key={plan.code}>
                <strong>{plan.name}</strong>
                <p>{plan.description}</p>
                <p>첫 결제: {formatMoney(plan.initialChargeAmount)}</p>
                <p>정기 과금: {formatMoney(plan.recurringChargeAmount)}</p>
              </article>
            ))}
          </div>

          <div className="button-row">
            <button className="primary-button" disabled={billingBusy} onClick={handleCreateBillingCheckout} type="button">
              {billingBusy ? '생성 중..' : '테스트 결제 / 코드 생성'}
            </button>
          </div>
        </article>
      </section>

      <section className="content-grid content-grid-wide">
        <article className="panel">
          <div className="panel-header-inline">
            <div>
              <h3>브랜드 할인 규칙</h3>
              <p className="page-copy">브랜드명이 맞으면 기본 판매가에 할인율을 자동 반영합니다.</p>
            </div>
            <button className="secondary-button" onClick={addBrandRule} type="button">
              규칙 추가
            </button>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>브랜드명</th>
                  <th>할인율(%)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {brandRules.map((rule, index) => (
                  <tr key={`brand-rule-${index}`}>
                    <td>
                      <input
                        onChange={(event) => updateBrandRule(index, 'brandName', event.target.value)}
                        value={rule.brandName}
                      />
                    </td>
                    <td>
                      <input
                        min={0}
                        onChange={(event) => updateBrandRule(index, 'discountRate', event.target.value)}
                        step="0.1"
                        type="number"
                        value={rule.discountRate}
                      />
                    </td>
                    <td>
                      <button className="table-action" onClick={() => removeBrandRule(index)} type="button">
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                {brandRules.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={3}>
                      저장된 브랜드 할인 규칙이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header-inline">
            <div>
              <h3>패턴 / 상품 할인 규칙</h3>
              <p className="page-copy">패턴명 또는 상품명 키워드가 맞으면 브랜드 규칙보다 우선 적용됩니다.</p>
            </div>
            <button className="secondary-button" onClick={addProductRule} type="button">
              규칙 추가
            </button>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>패턴 / 상품명 키워드</th>
                  <th>할인율(%)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {productRules.map((rule, index) => (
                  <tr key={`product-rule-${index}`}>
                    <td>
                      <input
                        onChange={(event) => updateProductRule(index, 'productName', event.target.value)}
                        value={rule.productName}
                      />
                    </td>
                    <td>
                      <input
                        min={0}
                        onChange={(event) => updateProductRule(index, 'discountRate', event.target.value)}
                        step="0.1"
                        type="number"
                        value={rule.discountRate}
                      />
                    </td>
                    <td>
                      <button className="table-action" onClick={() => removeProductRule(index)} type="button">
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                {productRules.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={3}>
                      저장된 패턴 / 상품 할인 규칙이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="content-grid content-grid-wide">
        <article className="panel">
          <div className="panel-header-inline">
            <div>
              <h3>공개 견적 발행</h3>
              <p className="page-copy">
                홈페이지용 견적 피드를 발행합니다. 실제 수량은 숨기고 견적 가능 여부만 노출됩니다.
              </p>
            </div>
            <button className="primary-button" disabled={publishing} onClick={handlePublishQuoteFeed} type="button">
              {publishing ? '발행 중...' : '지금 발행'}
            </button>
          </div>

          <div className="form-grid">
            <label className="field checkbox-field">
              <span>공개 견적 발행</span>
              <label className="checkbox-inline">
                <input
                  checked={publicQuotePreferences.enabled}
                  onChange={(event) => updatePublicQuotePreferences('enabled', event.target.checked)}
                  type="checkbox"
                />
                <span>운영앱에서 공개 견적 피드를 자동 발행합니다.</span>
              </label>
            </label>

            <label className="field field-wide">
              <span>발행 엔드포인트</span>
              <input
                onChange={(event) => updatePublicQuotePreferences('publishEndpoint', event.target.value)}
                placeholder="http://127.0.0.1:4174/quote-feed/publish"
                value={publicQuotePreferences.publishEndpoint}
              />
            </label>

            <label className="field">
              <span>인증 키</span>
              <input
                onChange={(event) => updatePublicQuotePreferences('publishAuthKey', event.target.value)}
                placeholder="Bearer token"
                value={publicQuotePreferences.publishAuthKey}
              />
            </label>

            <label className="field">
              <span>매장명</span>
              <input
                onChange={(event) => updatePublicQuotePreferences('storeName', event.target.value)}
                value={publicQuotePreferences.storeName}
              />
            </label>

            <label className="field">
              <span>서비스 지역</span>
              <input
                onChange={(event) => updatePublicQuotePreferences('serviceArea', event.target.value)}
                value={publicQuotePreferences.serviceArea}
              />
            </label>

            <label className="field">
              <span>대표 전화</span>
              <input
                onChange={(event) => updatePublicQuotePreferences('phoneNumber', event.target.value)}
                placeholder="010-0000-0000"
                value={publicQuotePreferences.phoneNumber}
              />
            </label>

            <label className="field">
              <span>카카오 문의 URL</span>
              <input
                onChange={(event) => updatePublicQuotePreferences('kakaoUrl', event.target.value)}
                placeholder="https://pf.kakao.com/..."
                value={publicQuotePreferences.kakaoUrl}
              />
            </label>

            <label className="field field-wide">
              <span>네이버스토어 URL</span>
              <input
                onChange={(event) => updatePublicQuotePreferences('naverStoreUrl', event.target.value)}
                placeholder="https://smartstore.naver.com/tire_sotre"
                value={publicQuotePreferences.naverStoreUrl}
              />
            </label>

            <label className="field">
              <span>기본 장착비(개당)</span>
              <input
                min={0}
                onChange={(event) =>
                  updatePublicQuotePreferences('defaultInstallationFee', normalizeMoneyInput(event.target.value))
                }
                type="number"
                value={publicQuotePreferences.defaultInstallationFee}
              />
            </label>

            <label className="field">
              <span>얼라인먼트 비용</span>
              <input
                min={0}
                onChange={(event) =>
                  updatePublicQuotePreferences('defaultAlignmentFee', normalizeMoneyInput(event.target.value))
                }
                type="number"
                value={publicQuotePreferences.defaultAlignmentFee}
              />
            </label>

            <label className="field field-wide">
              <span>견적 안내 문구</span>
              <input
                onChange={(event) => updatePublicQuotePreferences('quoteNotice', event.target.value)}
                value={publicQuotePreferences.quoteNotice}
              />
            </label>
          </div>

          <div className="note-box">
            <strong>최근 발행 상태</strong>
            <p>마지막 발행: {formatDateTime(publicQuotePreferences.lastPublishedAt)}</p>
            <p>마지막 오류: {publicQuotePreferences.lastPublishError || '없음'}</p>
          </div>
        </article>

        <article className="panel">
          <h3>최근 백업 기록</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>유형</th>
                  <th>경로</th>
                </tr>
              </thead>
              <tbody>
                {recentBackups.map((backup) => (
                  <tr key={backup.id}>
                    <td>{formatDateTime(backup.createdAt)}</td>
                    <td>{backup.backupType}</td>
                    <td>{backup.backupPath}</td>
                  </tr>
                ))}
                {recentBackups.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={3}>
                      아직 생성된 백업 기록이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
  )
}
