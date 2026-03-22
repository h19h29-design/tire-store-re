import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { selectCount, selectFirst } from '../../lib/db'
import { getRuntimeInfo } from '../../lib/desktop'
import {
  findFirstInvalidField,
  focusFieldErrorTarget,
  showErrorDialog,
  showValidationDialog,
  type FieldValidationMap,
} from '../../lib/dialogs'
import { formatMoney } from '../../lib/normalize'
import type {
  DashboardAnalytics,
  DashboardExpenseHistoryRow,
  DashboardExpenseRecord,
  DashboardPaymentFilters,
  DashboardRangeMode,
  DashboardSummary,
  RuntimeInfo,
} from '../../lib/types'
import {
  deleteDailyExpense,
  getCurrentMonthValue,
  getCurrentYearValue,
  getTodayValue,
  loadDailyExpense,
  loadDailyExpenseHistory,
  loadDashboardAnalytics,
  saveDailyExpense,
  saveLowStockThreshold,
} from './dashboardService'
import { deleteSale } from '../sales/salesService'

type ImportInfo = {
  sourceFile: string
  importedAt: string
  note: string
}

type BackupInfo = {
  backupPath: string
  createdAt: string
}

type SystemCard = {
  label: string
  value: number
}

type DashboardFieldKey =
  | 'dashboard-expense-date'
  | 'dashboard-expense-amount'
  | 'dashboard-low-stock-threshold'

type DashboardAppliedFilters = {
  rangeMode: DashboardRangeMode
  dateValue: string
  monthValue: string
  yearValue: string
}

const defaultCards: SystemCard[] = [
  { label: '등록 품목', value: 0 },
  { label: '재고 보유 품목', value: 0 },
  { label: '총 재고 수량', value: 0 },
  { label: '저재고 품목', value: 0 },
  { label: '고객 수', value: 0 },
  { label: '누적 판매', value: 0 },
]

const defaultExpenseRecord: DashboardExpenseRecord = {
  expenseDate: getTodayValue(),
  amount: 0,
  note: '',
  updatedAt: null,
}

const defaultPaymentFilters: DashboardPaymentFilters = {
  card: true,
  cash: true,
  naver: true,
}

const currentYearNumber = Number(getCurrentYearValue())
const dashboardYearOptions = Array.from(
  { length: Math.max(currentYearNumber - 2000 + 2, 1) },
  (_, index) => String(currentYearNumber + 1 - index),
)
const dashboardMonthOptions = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, '0'),
  label: `${index + 1}월`,
}))

function getSelectedPaymentAmount(summary: DashboardSummary | null, filters: DashboardPaymentFilters) {
  if (!summary) {
    return 0
  }

  return (
    (filters.card ? summary.cardAmount : 0) +
    (filters.naver ? summary.naverAmount : 0) +
    (filters.cash ? summary.cashAmount : 0)
  )
}

function getSelectedPaymentLabel(filters: DashboardPaymentFilters) {
  const labels = [
    filters.card ? '카드' : null,
    filters.naver ? '네이버' : null,
    filters.cash ? '현금' : null,
  ].filter(Boolean)

  if (labels.length === 0) {
    return '선택 없음'
  }

  return labels.join(' + ')
}

function getRangeValue(rangeMode: DashboardRangeMode, dateValue: string, monthValue: string, yearValue: string) {
  switch (rangeMode) {
    case 'year':
      return yearValue
    case 'month':
      return monthValue
    case 'date':
    default:
      return dateValue
  }
}

function getPeriodLabel(rangeMode: DashboardRangeMode) {
  switch (rangeMode) {
    case 'year':
      return '연간'
    case 'month':
      return '월간'
    case 'date':
    default:
      return '일간'
  }
}

function getBucketTitle(rangeMode: DashboardRangeMode) {
  switch (rangeMode) {
    case 'year':
      return '월별 판매 내역'
    case 'month':
      return '일자별 판매 내역'
    case 'date':
    default:
      return '선택 날짜 판매 내역'
  }
}

function getBucketColumnLabel(rangeMode: DashboardRangeMode) {
  switch (rangeMode) {
    case 'year':
      return '월'
    case 'month':
      return '일자'
    case 'date':
    default:
      return '날짜'
  }
}

function buildMonthValue(year: string, month: string) {
  return `${year}-${month.padStart(2, '0')}`
}

function getMonthYearPart(value: string) {
  return value.slice(0, 4)
}

function getMonthNumberPart(value: string) {
  return value.slice(5, 7)
}

function getSalesHistoryTitle(rangeMode: DashboardRangeMode) {
  switch (rangeMode) {
    case 'year':
      return '월별 상세 판매 내역'
    case 'month':
      return '선택 월 상세 판매 내역'
    case 'date':
    default:
      return '선택 날짜 상세 판매 내역'
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return '대시보드 작업 중 오류가 발생했습니다.'
}

function sanitizeExpenseAmountInput(value: string) {
  return value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '')
}

function getSettledValue<T>(result: PromiseSettledResult<T>, fallback: T) {
  return result.status === 'fulfilled' ? result.value : fallback
}

function countRejectedResults(results: PromiseSettledResult<unknown>[]) {
  return results.filter((result) => result.status === 'rejected').length
}

function logRejectedDashboardResult(label: string, result: PromiseSettledResult<unknown>) {
  if (result.status === 'rejected') {
    console.error(`Failed to load dashboard data: ${label}`, result.reason)
  }
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [appliedFilters, setAppliedFilters] = useState<DashboardAppliedFilters>({
    rangeMode: 'date',
    dateValue: getTodayValue(),
    monthValue: getCurrentMonthValue(),
    yearValue: getCurrentYearValue(),
  })
  const [rangeMode, setRangeMode] = useState<DashboardRangeMode>('date')
  const [dateValue, setDateValue] = useState(getTodayValue())
  const [monthValue, setMonthValue] = useState(getCurrentMonthValue())
  const [yearValue, setYearValue] = useState(getCurrentYearValue())
  const [cards, setCards] = useState(defaultCards)
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [latestImport, setLatestImport] = useState<ImportInfo | null>(null)
  const [latestBackup, setLatestBackup] = useState<BackupInfo | null>(null)
  const [expenseDate, setExpenseDate] = useState(getTodayValue())
  const [expenseDraft, setExpenseDraft] = useState<DashboardExpenseRecord>(defaultExpenseRecord)
  const [expenseAmountInput, setExpenseAmountInput] = useState('0')
  const [expenseHistory, setExpenseHistory] = useState<DashboardExpenseHistoryRow[]>([])
  const [lowStockThresholdInput, setLowStockThresholdInput] = useState('4')
  const [paymentFilters, setPaymentFilters] = useState<DashboardPaymentFilters>(defaultPaymentFilters)
  const [status, setStatus] = useState('판매 분석을 불러오는 중입니다.')
  const [refreshKey, setRefreshKey] = useState(0)
  const [savingExpense, setSavingExpense] = useState(false)
  const [savingThreshold, setSavingThreshold] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldValidationMap<DashboardFieldKey>>({})

  useEffect(() => {
    if (rangeMode === 'date') {
      setExpenseDate(dateValue)
    }
  }, [rangeMode, dateValue])

  useEffect(() => {
    let active = true
    const rangeValue = getRangeValue(
      appliedFilters.rangeMode,
      appliedFilters.dateValue,
      appliedFilters.monthValue,
      appliedFilters.yearValue,
    )

    async function loadDashboard() {
      try {
        const [itemsResult, customersResult, salesResult, runtimeResult, importResult, backupResult, analyticsResult, expenseHistoryResult] =
          await Promise.allSettled([
            selectCount('SELECT COUNT(*) AS count FROM items'),
            selectCount('SELECT COUNT(*) AS count FROM customers'),
            selectCount('SELECT COUNT(*) AS count FROM sales'),
            getRuntimeInfo(),
            selectFirst<ImportInfo>(
              `SELECT
                source_file AS sourceFile,
                imported_at AS importedAt,
                note AS note
              FROM imports
              ORDER BY id DESC
              LIMIT 1`,
            ),
            selectFirst<BackupInfo>(
              `SELECT
                backup_path AS backupPath,
                created_at AS createdAt
              FROM backups
              ORDER BY id DESC
              LIMIT 1`,
            ),
            loadDashboardAnalytics(appliedFilters.rangeMode, rangeValue),
            loadDailyExpenseHistory(appliedFilters.rangeMode, rangeValue),
          ])

        if (!active) {
          return
        }

        if (analyticsResult.status === 'rejected') {
          throw analyticsResult.reason
        }

        const nextAnalytics = analyticsResult.value
        const items = getSettledValue(itemsResult, 0)
        const customers = getSettledValue(customersResult, 0)
        const sales = getSettledValue(salesResult, 0)
        const runtime = runtimeResult.status === 'fulfilled' ? runtimeResult.value : null
        const importInfo = importResult.status === 'fulfilled' ? importResult.value : null
        const backupInfo = backupResult.status === 'fulfilled' ? backupResult.value : null
        const nextExpenseHistory = expenseHistoryResult.status === 'fulfilled' ? expenseHistoryResult.value : []

        logRejectedDashboardResult('items count', itemsResult)
        logRejectedDashboardResult('customers count', customersResult)
        logRejectedDashboardResult('sales count', salesResult)
        logRejectedDashboardResult('runtime info', runtimeResult)
        logRejectedDashboardResult('latest import', importResult)
        logRejectedDashboardResult('latest backup', backupResult)
        logRejectedDashboardResult('expense history', expenseHistoryResult)

        const recoveredWarningCount =
          nextAnalytics.warnings.length +
          countRejectedResults([
            itemsResult,
            customersResult,
            salesResult,
            runtimeResult,
            importResult,
            backupResult,
            expenseHistoryResult,
          ])

        setCards([
          { label: '등록 품목', value: items },
          { label: '재고 보유 품목', value: nextAnalytics.inventory.stockedItemCount },
          { label: '총 재고 수량', value: nextAnalytics.inventory.totalQuantity },
          { label: '저재고 품목', value: nextAnalytics.inventory.lowStockItemCount },
          { label: '고객 수', value: customers },
          { label: '누적 판매', value: sales },
        ])
        setRuntimeInfo(runtime)
        setLatestImport(importInfo)
        setLatestBackup(backupInfo)
        setAnalytics(nextAnalytics)
        setExpenseHistory(nextExpenseHistory)
        setLowStockThresholdInput(String(nextAnalytics.inventory.lowStockThreshold))
        setStatus(
          recoveredWarningCount > 0
            ? `${getPeriodLabel(appliedFilters.rangeMode)} 기준 ${rangeValue} 판매 분석을 표시 중이며 일부 보조 정보를 기본값으로 표시했습니다.`
            : `${getPeriodLabel(appliedFilters.rangeMode)} 기준 ${rangeValue} 판매 분석을 표시 중입니다.`,
        )
      } catch (error) {
        console.error(error)
        if (active) {
          setStatus('대시보드 정보를 불러오는 중 오류가 발생했습니다.')
          setExpenseHistory([])
        }
      }
    }

    void loadDashboard()
    return () => {
      active = false
    }
  }, [appliedFilters, refreshKey])

  useEffect(() => {
    let active = true

    async function loadExpense() {
      try {
        const nextExpense = await loadDailyExpense(expenseDate)
        if (!active) {
          return
        }

        setExpenseDraft(nextExpense)
        setExpenseAmountInput(String(Math.max(0, nextExpense.amount)))
      } catch (error) {
        console.error(error)
        if (active) {
          setExpenseDraft({
            expenseDate,
            amount: 0,
            note: '',
            updatedAt: null,
          })
          setExpenseAmountInput('0')
          setStatus((current) =>
            current === '판매 분석을 불러오는 중입니다.'
              ? '일일 지출 정보를 불러오지 못해 빈 값으로 시작합니다.'
              : current,
          )
        }
      }
    }

    void loadExpense()
    return () => {
      active = false
    }
  }, [expenseDate, refreshKey])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || !isEditableElement(event.target)) {
        return
      }

      const hasPendingExpenseInput =
        expenseDate !== getTodayValue() ||
        expenseAmountInput !== '0' ||
        expenseDraft.note.trim() !== '' ||
        Object.keys(fieldErrors).length > 0

      if (!hasPendingExpenseInput) {
        return
      }

      event.preventDefault()
      setExpenseDate(getTodayValue())
      setExpenseDraft(defaultExpenseRecord)
      setExpenseAmountInput('0')
      setFieldErrors({})
      setStatus('지출 입력을 취소했습니다.')
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [expenseAmountInput, expenseDate, expenseDraft.note, fieldErrors])

  function handleApplyFilters() {
    setAppliedFilters({
      rangeMode,
      dateValue,
      monthValue,
      yearValue,
    })
    setRefreshKey((current) => current + 1)
    setStatus('선택한 기간을 다시 조회하는 중입니다.')
  }

  async function handleSaveExpense() {
    const expenseAmount = Math.max(0, Number(expenseAmountInput || 0))
    const issues: string[] = []
    const nextFieldErrors: FieldValidationMap<DashboardFieldKey> = {}
    const fieldOrder: DashboardFieldKey[] = []

    if (!expenseDate) {
      const message = '지출 날짜를 선택해 주세요.'
      issues.push(message)
      nextFieldErrors['dashboard-expense-date'] = message
      fieldOrder.push('dashboard-expense-date')
    }

    if (expenseAmount < 0) {
      const message = '지출 금액은 0 이상이어야 합니다.'
      issues.push(message)
      nextFieldErrors['dashboard-expense-amount'] = message
      fieldOrder.push('dashboard-expense-amount')
    }

    if (issues.length > 0) {
      const firstField = findFirstInvalidField(fieldOrder, nextFieldErrors)
      setFieldErrors((current) => ({
        ...current,
        ...nextFieldErrors,
      }))
      setStatus(issues[0] ?? '지출 입력값을 확인해 주세요.')
      await showValidationDialog(issues, '지출 입력 확인')
      if (firstField) {
        focusFieldErrorTarget(firstField)
      }
      return
    }

    try {
      setSavingExpense(true)
      await saveDailyExpense({
        expenseDate,
        amount: expenseAmount,
        note: expenseDraft.note,
      })
      setStatus(`${expenseDate} 일일 지출을 저장했습니다.`)
      setRefreshKey((current) => current + 1)
    } catch (error) {
      console.error(error)
      setStatus(getErrorMessage(error))
      await showErrorDialog(error, '지출 저장 실패')
    } finally {
      setSavingExpense(false)
    }
  }

  async function handleDeleteExpense(targetExpenseDate: string) {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`${targetExpenseDate} 지출 내역을 삭제할까요?`)
    ) {
      return
    }

    try {
      setSavingExpense(true)
      await deleteDailyExpense(targetExpenseDate)
      if (expenseDate === targetExpenseDate) {
        setExpenseDraft({
          expenseDate: targetExpenseDate,
          amount: 0,
          note: '',
          updatedAt: null,
        })
        setExpenseAmountInput('0')
      }
      setStatus(`${targetExpenseDate} 지출 내역을 삭제했습니다.`)
      setRefreshKey((current) => current + 1)
    } catch (error) {
      console.error(error)
      setStatus(getErrorMessage(error))
      await showErrorDialog(error, '지출 삭제 실패')
    } finally {
      setSavingExpense(false)
    }
  }

  async function handleSaveLowStockThreshold() {
    const thresholdValue = Number(lowStockThresholdInput)
    if (!Number.isFinite(thresholdValue) || thresholdValue < 0) {
      const message = '저재고 기준은 0 이상의 숫자로 입력해 주세요.'
      setFieldErrors((current) => ({
        ...current,
        'dashboard-low-stock-threshold': message,
      }))
      setStatus(message)
      await showValidationDialog([message], '저재고 기준 확인')
      focusFieldErrorTarget('dashboard-low-stock-threshold')
      return
    }

    try {
      setSavingThreshold(true)
      await saveLowStockThreshold(thresholdValue)
      setStatus(`저재고 기준을 ${Math.max(0, Math.floor(thresholdValue || 0))}개로 저장했습니다.`)
      setRefreshKey((current) => current + 1)
    } catch (error) {
      console.error(error)
      setStatus(getErrorMessage(error))
      await showErrorDialog(error, '저재고 기준 저장 실패')
    } finally {
      setSavingThreshold(false)
    }
  }

  async function handleDeleteSale(saleId: number) {
    if (typeof window !== 'undefined' && !window.confirm('이 판매 내역을 삭제할까요? 타이어 재고도 같이 복구됩니다.')) {
      return
    }

    try {
      setStatus('판매 내역을 삭제하는 중입니다.')
      await deleteSale(saleId)
      setRefreshKey((current) => current + 1)
      setStatus('판매 내역을 삭제했습니다. 관련 재고도 복구되었습니다.')
    } catch (error) {
      console.error(error)
      setStatus(getErrorMessage(error))
      await showErrorDialog(error, '판매 삭제 실패')
    }
  }

  const todaySummary = analytics?.today
  const periodSummary = analytics?.period
  const todaySelectedPaymentAmount = getSelectedPaymentAmount(todaySummary ?? null, paymentFilters)
  const periodSelectedPaymentAmount = getSelectedPaymentAmount(periodSummary ?? null, paymentFilters)
  const selectedPaymentLabel = getSelectedPaymentLabel(paymentFilters)
  const validation = analytics?.validation
  const activeFieldErrors: FieldValidationMap<DashboardFieldKey> = { ...fieldErrors }
  const currentThresholdValue = Number(lowStockThresholdInput)
  const selectedMonthYear = getMonthYearPart(monthValue)
  const selectedMonthNumber = getMonthNumberPart(monthValue)
  const appliedRangeMode = appliedFilters.rangeMode

  if (expenseDate) {
    delete activeFieldErrors['dashboard-expense-date']
  }

  if (expenseDraft.amount >= 0) {
    delete activeFieldErrors['dashboard-expense-amount']
  }

  if (Number.isFinite(currentThresholdValue) && currentThresholdValue >= 0) {
    delete activeFieldErrors['dashboard-low-stock-threshold']
  }

  const expenseDateError = activeFieldErrors['dashboard-expense-date']
  const expenseAmountError = activeFieldErrors['dashboard-expense-amount']
  const thresholdError = activeFieldErrors['dashboard-low-stock-threshold']

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">대시보드</p>
          <h2>대시보드</h2>
          <p className="page-copy">
            오늘 판매 요약, 카드수수료가 반영된 수익, 재고 현황, 기간별 판매량을 한 화면에서 확인할 수 있게
            정리했습니다.
          </p>
        </div>
        <div className="status-pill">{status}</div>
      </header>

      <section className="panel dashboard-headline-panel">
        <div className="dashboard-headline-grid">
          <article className="dashboard-headline-card">
            <p className="dashboard-headline-label">전일수량</p>
            <strong className="dashboard-headline-value">
              {(analytics?.headline.previousQuantity ?? 0).toLocaleString('ko-KR')}
            </strong>
          </article>
          <article className="dashboard-headline-card">
            <p className="dashboard-headline-label">당일판매</p>
            <strong className="dashboard-headline-value">
              {(analytics?.headline.todayQuantity ?? 0).toLocaleString('ko-KR')}
            </strong>
          </article>
          <article className="dashboard-headline-card">
            <p className="dashboard-headline-label">누계</p>
            <strong className="dashboard-headline-value">
              {(analytics?.headline.cumulativeQuantity ?? 0).toLocaleString('ko-KR')}
            </strong>
          </article>
          <article className="dashboard-headline-card">
            <p className="dashboard-headline-label">전일수익</p>
            <strong className="dashboard-headline-value dashboard-headline-value-profit">
              {formatMoney(analytics?.headline.previousProfit ?? 0)}원
            </strong>
          </article>
          <article className="dashboard-headline-card">
            <p className="dashboard-headline-label">당일수익</p>
            <strong className="dashboard-headline-value dashboard-headline-value-profit">
              {formatMoney(analytics?.headline.todayProfit ?? 0)}원
            </strong>
          </article>
          <article className="dashboard-headline-card">
            <p className="dashboard-headline-label">누계</p>
            <strong className="dashboard-headline-value dashboard-headline-value-profit">
              {formatMoney(analytics?.headline.cumulativeProfit ?? 0)}원
            </strong>
          </article>
        </div>
      </section>

      <section className="panel hero-panel">
        <div className="hero-header">
          <div>
            <p className="eyebrow">오늘</p>
            <h3>오늘 판매 요약</h3>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--muted)' }}>
              순이익 = 타이어 매출 + 작업비 - 타이어 원가 - 카드수수료 - 일일 지출
            </p>
          </div>
          <strong className="hero-amount">{formatMoney(todaySummary?.netProfit ?? 0)}원</strong>
        </div>

        <div className="stat-grid">
          <article className="stat-card">
            <p className="stat-label">총 매출</p>
            <strong className="stat-value small-value">{formatMoney(todaySummary?.totalAmount ?? 0)}원</strong>
          </article>
          <article className="stat-card">
            <p className="stat-label">선택 결제 매출</p>
            <strong className="stat-value small-value">{formatMoney(todaySelectedPaymentAmount)}원</strong>
          </article>
          <article className="stat-card">
            <p className="stat-label">판매 건수 / 수량</p>
            <strong className="stat-value small-value">
              {(todaySummary?.salesCount ?? 0).toLocaleString('ko-KR')}건 / {(todaySummary?.tireQuantity ?? 0).toLocaleString('ko-KR')}본
            </strong>
          </article>
          <article className="stat-card">
            <p className="stat-label">타이어 매출</p>
            <strong className="stat-value small-value">{formatMoney(todaySummary?.tireSalesAmount ?? 0)}원</strong>
          </article>
          <article className="stat-card">
            <p className="stat-label">타이어 원가</p>
            <strong className="stat-value small-value">{formatMoney(todaySummary?.tireCostAmount ?? 0)}원</strong>
          </article>
          <article className="stat-card">
            <p className="stat-label">카드수수료 / 지출</p>
            <strong className="stat-value small-value">
              {formatMoney(todaySummary?.cardFeeAmount ?? 0)}원 / {formatMoney(todaySummary?.expenseAmount ?? 0)}원
            </strong>
          </article>
          <article className="stat-card">
            <p className="stat-label">작업비 / 타이어 수익</p>
            <strong className="stat-value small-value">
              {formatMoney(todaySummary?.serviceAmount ?? 0)}원 / {formatMoney(todaySummary?.tireProfit ?? 0)}원
            </strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="filter-grid dashboard-filter-grid">
          <label className="field">
            <span>조회 단위</span>
            <select
              className="field-select"
              onChange={(event) => setRangeMode(event.target.value as DashboardRangeMode)}
              value={rangeMode}
            >
              <option value="date">날짜별</option>
              <option value="month">월별</option>
              <option value="year">연도별</option>
            </select>
          </label>

          {rangeMode === 'date' ? (
            <label className="field">
              <span>조회 날짜</span>
              <input onChange={(event) => setDateValue(event.target.value)} type="date" value={dateValue} />
            </label>
          ) : null}

          {rangeMode === 'month' ? (
            <>
              <label className="field">
                <span>조회 연도</span>
                <select
                  className="field-select"
                  onChange={(event) => setMonthValue(buildMonthValue(event.target.value, selectedMonthNumber))}
                  value={selectedMonthYear}
                >
                  {dashboardYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}년
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>조회 월</span>
                <select
                  className="field-select"
                  onChange={(event) => setMonthValue(buildMonthValue(selectedMonthYear, event.target.value))}
                  value={selectedMonthNumber}
                >
                  {dashboardMonthOptions.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {rangeMode === 'year' ? (
            <label className="field">
              <span>조회 연도</span>
              <select className="field-select" onChange={(event) => setYearValue(event.target.value)} value={yearValue}>
                {dashboardYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="field dashboard-query-action">
            <span>조회 실행</span>
            <button className="primary-button" onClick={handleApplyFilters} type="button">
              조회
            </button>
          </div>
        </div>

        <div className="payment-filter-row">
          <span className="payment-filter-title">결제구분 매출 보기</span>
          <label className="checkbox-inline">
            <input
              checked={paymentFilters.card}
              onChange={(event) =>
                setPaymentFilters((current) => ({
                  ...current,
                  card: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>카드</span>
          </label>
          <label className="checkbox-inline">
            <input
              checked={paymentFilters.naver}
              onChange={(event) =>
                setPaymentFilters((current) => ({
                  ...current,
                  naver: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>네이버</span>
          </label>
          <label className="checkbox-inline">
            <input
              checked={paymentFilters.cash}
              onChange={(event) =>
                setPaymentFilters((current) => ({
                  ...current,
                  cash: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>현금</span>
          </label>
          <span className="payment-filter-summary">
            {selectedPaymentLabel} 기준 {formatMoney(periodSelectedPaymentAmount)}원
          </span>
        </div>

        <div className="stat-grid">
          <article className="panel stat-card">
            <p className="stat-label">{getPeriodLabel(appliedRangeMode)} 순이익</p>
            <strong className="stat-value small-value">{formatMoney(periodSummary?.netProfit ?? 0)}원</strong>
          </article>
          <article className="panel stat-card">
            <p className="stat-label">{getPeriodLabel(appliedRangeMode)} 타이어 수익</p>
            <strong className="stat-value small-value">{formatMoney(periodSummary?.tireProfit ?? 0)}원</strong>
          </article>
          <article className="panel stat-card">
            <p className="stat-label">{getPeriodLabel(appliedRangeMode)} 카드수수료</p>
            <strong className="stat-value small-value">{formatMoney(periodSummary?.cardFeeAmount ?? 0)}원</strong>
          </article>
          <article className="panel stat-card">
            <p className="stat-label">{getPeriodLabel(appliedRangeMode)} 총매출</p>
            <strong className="stat-value small-value">{formatMoney(periodSummary?.totalAmount ?? 0)}원</strong>
          </article>
          <article className="panel stat-card">
            <p className="stat-label">{getPeriodLabel(appliedRangeMode)} 선택 결제 매출</p>
            <strong className="stat-value small-value">{formatMoney(periodSelectedPaymentAmount)}원</strong>
          </article>
          <article className="panel stat-card">
            <p className="stat-label">{getPeriodLabel(appliedRangeMode)} 작업비 / 지출</p>
            <strong className="stat-value small-value">
              {formatMoney(periodSummary?.serviceAmount ?? 0)}원 / {formatMoney(periodSummary?.expenseAmount ?? 0)}원
            </strong>
          </article>
          <article className="panel stat-card">
            <p className="stat-label">{getPeriodLabel(appliedRangeMode)} 판매 건수 / 수량</p>
            <strong className="stat-value small-value">
              {(periodSummary?.salesCount ?? 0).toLocaleString('ko-KR')}건 / {(periodSummary?.tireQuantity ?? 0).toLocaleString('ko-KR')}본
            </strong>
          </article>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel">
          <h3>일일 지출 입력</h3>
          <div className="form-grid">
            <label className={`field${expenseDateError ? ' has-error' : ''}`}>
              <span>지출 날짜</span>
              <input
                aria-invalid={Boolean(expenseDateError)}
                data-field-error-target="dashboard-expense-date"
                onChange={(event) => setExpenseDate(event.target.value)}
                type="date"
                value={expenseDate}
              />
              {expenseDateError ? <small className="field-error-text">{expenseDateError}</small> : null}
            </label>
            <label className={`field${expenseAmountError ? ' has-error' : ''}`}>
              <span>지출 금액(원)</span>
              <input
                aria-invalid={Boolean(expenseAmountError)}
                data-field-error-target="dashboard-expense-amount"
                inputMode="numeric"
                onChange={(event) =>
                  {
                    const nextValue = sanitizeExpenseAmountInput(event.target.value)
                    setExpenseAmountInput(nextValue)
                    setExpenseDraft((current) => ({
                      ...current,
                      amount: Number(nextValue || 0),
                    }))
                  }
                }
                onBlur={() => {
                  if (!expenseAmountInput) {
                    setExpenseAmountInput('0')
                    setExpenseDraft((current) => ({
                      ...current,
                      amount: 0,
                    }))
                  }
                }}
                onFocus={() => {
                  if (expenseAmountInput === '0') {
                    setExpenseAmountInput('')
                  }
                }}
                placeholder="예: 45000"
                type="text"
                value={expenseAmountInput}
              />
              {expenseAmountError ? <small className="field-error-text">{expenseAmountError}</small> : null}
            </label>
            <label className="field field-wide">
              <span>비고</span>
              <input
                onChange={(event) =>
                  setExpenseDraft((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                placeholder="예: 생활비, 간식비, 외주비"
                value={expenseDraft.note}
              />
            </label>
          </div>

          <div className="button-row">
            <button className="primary-button" disabled={savingExpense} onClick={handleSaveExpense} type="button">
              {savingExpense ? '저장 중..' : '지출 저장'}
            </button>
          </div>

          <div className="note-box">
            <strong>{expenseDate} 지출 반영</strong>
            <p>
              마지막 수정 시각은 {expenseDraft.updatedAt ?? '아직 없습니다.'}입니다. 저장한 지출은 일간, 월간, 연간
              수익 계산에서 자동으로 차감됩니다.
            </p>
          </div>

          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{getPeriodLabel(appliedRangeMode)} 지출일</th>
                  <th>금액</th>
                  <th>비고</th>
                  <th>수정시각</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expenseHistory.map((row) => (
                  <tr key={`${row.expenseDate}-${row.updatedAt ?? 'none'}`}>
                    <td>{row.expenseDate}</td>
                    <td>{formatMoney(row.amount)}원</td>
                    <td>{row.note || '-'}</td>
                    <td>{row.updatedAt ?? '-'}</td>
                    <td>
                      <button
                        className="table-action"
                        disabled={savingExpense}
                        onClick={() => {
                          void handleDeleteExpense(row.expenseDate)
                        }}
                        type="button"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                {expenseHistory.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={5}>
                      선택한 기간의 지출 내역이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h3>운영 현황</h3>
          <div className="stat-grid compact-stat-grid">
            {cards.map((card) => (
              <article className="stat-card" key={card.label}>
                <p className="stat-label">{card.label}</p>
                <strong className="stat-value">{card.value.toLocaleString('ko-KR')}</strong>
              </article>
            ))}
          </div>

          <dl className="info-list">
            <div>
              <dt>마지막 가져오기</dt>
              <dd>{latestImport?.importedAt ?? '-'}</dd>
            </div>
            <div>
              <dt>가져온 파일</dt>
              <dd>{latestImport?.sourceFile ?? '아직 없습니다.'}</dd>
            </div>
            <div>
              <dt>가져오기 메모</dt>
              <dd>{latestImport?.note ?? '-'}</dd>
            </div>
            <div>
              <dt>마지막 백업</dt>
              <dd>{latestBackup?.createdAt ?? '-'}</dd>
            </div>
            <div>
              <dt>백업 경로</dt>
              <dd>{latestBackup?.backupPath ?? '아직 없습니다.'}</dd>
            </div>
            <div>
              <dt>DB 파일</dt>
              <dd>{runtimeInfo?.dbPath ?? '-'}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <h3>브랜드별 판매 분석</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>브랜드</th>
                  <th>판매량</th>
                  <th>매출</th>
                </tr>
              </thead>
              <tbody>
                {analytics?.topBrands.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.quantity.toLocaleString('ko-KR')}</td>
                    <td>{formatMoney(row.amount)}원</td>
                  </tr>
                ))}
                {(analytics?.topBrands.length ?? 0) === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={3}>
                      선택한 기간의 판매 데이터가 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h3>규격별 판매 분석</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>규격</th>
                  <th>판매량</th>
                  <th>매출</th>
                </tr>
              </thead>
              <tbody>
                {analytics?.topSizes.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.quantity.toLocaleString('ko-KR')}</td>
                    <td>{formatMoney(row.amount)}원</td>
                  </tr>
                ))}
                {(analytics?.topSizes.length ?? 0) === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={3}>
                      선택한 기간의 판매 데이터가 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <h3>{getBucketTitle(appliedRangeMode)}</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{getBucketColumnLabel(appliedRangeMode)}</th>
                  <th>판매건수</th>
                  <th>타이어 수량</th>
                  <th>총매출</th>
                  <th>결제구분</th>
                </tr>
              </thead>
              <tbody>
                {analytics?.periodBuckets.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.salesCount.toLocaleString('ko-KR')}건</td>
                    <td>{row.quantity.toLocaleString('ko-KR')}</td>
                    <td>{formatMoney(row.totalAmount)}원</td>
                    <td>
                      카드 {formatMoney(row.cardAmount)}원 / 네이버 {formatMoney(row.naverAmount)}원 / 현금 {formatMoney(row.cashAmount)}원
                    </td>
                  </tr>
                ))}
                {(analytics?.periodBuckets.length ?? 0) === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={5}>
                      선택한 기간에 표시할 판매 집계가 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h3>판매량 정합성 검증</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>비교 항목</th>
                  <th>수량</th>
                  <th>결과</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>선택 기간 판매량</td>
                  <td>{(validation?.periodTireQuantity ?? 0).toLocaleString('ko-KR')}</td>
                  <td>기준값</td>
                </tr>
                <tr>
                  <td>{validation?.groupedLabel ?? '구간 집계'}</td>
                  <td>{(validation?.groupedQuantity ?? 0).toLocaleString('ko-KR')}</td>
                  <td>{validation?.groupedMatches ? '일치' : '확인 필요'}</td>
                </tr>
                <tr>
                  <td>브랜드 분석 합계</td>
                  <td>{(validation?.brandQuantity ?? 0).toLocaleString('ko-KR')}</td>
                  <td>{validation?.brandMatches ? '일치' : '확인 필요'}</td>
                </tr>
                <tr>
                  <td>규격 분석 합계</td>
                  <td>{(validation?.sizeQuantity ?? 0).toLocaleString('ko-KR')}</td>
                  <td>{validation?.sizeMatches ? '일치' : '확인 필요'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'space-between' }}>
            <div>
              <h3>저재고 품목</h3>
              <p style={{ margin: '0.5rem 0 0', color: 'var(--muted)' }}>
                현재 {analytics?.inventory.lowStockThreshold ?? 4}개 이하 품목 {(analytics?.inventory.lowStockItemCount ?? 0).toLocaleString('ko-KR')}건
              </p>
            </div>
            <div className={`field${thresholdError ? ' has-error' : ''}`} style={{ minWidth: '16rem' }}>
              <div className="inline-field">
                <input
                  aria-invalid={Boolean(thresholdError)}
                  data-field-error-target="dashboard-low-stock-threshold"
                  inputMode="numeric"
                  min={0}
                  onChange={(event) => setLowStockThresholdInput(event.target.value)}
                  type="number"
                  value={lowStockThresholdInput}
                />
                <button
                  className="secondary-button"
                  disabled={savingThreshold}
                  onClick={handleSaveLowStockThreshold}
                  type="button"
                >
                  {savingThreshold ? '저장 중..' : '기준 저장'}
                </button>
              </div>
              {thresholdError ? <small className="field-error-text">{thresholdError}</small> : null}
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>브랜드</th>
                  <th>패턴</th>
                  <th>규격</th>
                  <th>가용 재고</th>
                </tr>
              </thead>
              <tbody>
                {analytics?.lowStockItems.map((item) => (
                  <tr key={item.itemId}>
                    <td>{item.brandName}</td>
                    <td>{item.patternName}</td>
                    <td>{item.sizeLabel}</td>
                    <td>{item.quantityAvailable.toLocaleString('ko-KR')}</td>
                  </tr>
                ))}
                {(analytics?.lowStockItems.length ?? 0) === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={4}>
                      현재 기준에서 저재고 품목이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h3>{getSalesHistoryTitle(appliedRangeMode)}</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>판매일시</th>
                  <th>차량번호 / 고객</th>
                  <th>타이어 수량</th>
                  <th>결제구분</th>
                  <th>금액</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {analytics?.recentSales.map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.soldAt}</td>
                    <td>
                      <strong>{sale.plateNumber || '-'}</strong>
                      <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
                        {sale.customerName || '미등록 고객'}
                      </div>
                    </td>
                    <td>{sale.tireQuantity.toLocaleString('ko-KR')}</td>
                    <td>
                      <div>카드 {formatMoney(sale.cardAmount)}원</div>
                      <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
                        네이버 {formatMoney(sale.naverAmount)}원 / 현금 {formatMoney(sale.cashAmount)}원
                      </div>
                    </td>
                    <td>{formatMoney(sale.totalAmount)}원</td>
                    <td>
                      <div className="button-row" style={{ justifyContent: 'flex-end', marginTop: 0 }}>
                        <button
                          className="table-action"
                          onClick={() => navigate(`/app/sales?saleId=${sale.id}`)}
                          type="button"
                        >
                          수정
                        </button>
                        <button
                          className="table-action"
                          onClick={() => {
                            void handleDeleteSale(sale.id)
                          }}
                          type="button"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(analytics?.recentSales.length ?? 0) === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={6}>
                      선택한 기간의 판매 내역이 없습니다.
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
