import { execute, selectFirst, selectRows } from '../../lib/db'
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  loadLowStockThresholdSetting,
  saveLowStockThresholdSetting,
} from '../../lib/appSettings'
import { ensureRuntimeReady } from '../../lib/desktop'
import { normalizeText } from '../../lib/normalize'
import type {
  DashboardAnalytics,
  DashboardBreakdownRow,
  DashboardExpenseHistoryRow,
  DashboardExpenseInput,
  DashboardExpenseRecord,
  DashboardHeadlineMetrics,
  DashboardInventoryMetrics,
  DashboardLowStockRow,
  DashboardPeriodBucketRow,
  DashboardRangeMode,
  DashboardRecentSaleRow,
  DashboardSummary,
  DashboardValidation,
} from '../../lib/types'
import { loadBrandDiscountRules, loadProductDiscountRules } from '../settings/settingsService'

type SummarySalesRow = {
  salesCount: number
  totalAmount: number
  cardAmount: number
  naverAmount: number
  cashAmount: number
  cardFeeAmount: number
}

type SummaryLinesRow = {
  tireQuantity: number
  tireSalesAmount: number
  tireCostAmount: number
  serviceAmount: number
}

type SummaryLineCostRow = {
  lineType: string
  quantity: number
  lineTotal: number
  costPriceSnapshot: number
  discountedUnitPriceSnapshot: number
  brandName: string
  patternName: string
  productName: string
  defaultDiscountRate: number
}

type ExpenseSumRow = {
  expenseAmount: number
}

type InventoryMetricsRow = {
  totalQuantity: number
  stockedItemCount: number
  lowStockItemCount: number
}

type RawSizeBreakdownRow = {
  sizeLabel: string
  patternName: string
  quantity: number
  amount: number
}

type DailyExpenseRow = {
  expenseDate: string
  amount: number
  note: string
  updatedAt: string | null
}

type DashboardLoadResult<T> = {
  value: T
  warning: string | null
}

let dashboardSchemaPromise: Promise<void> | null = null
const legacyVehiclePlateSql = "REPLACE(REPLACE(TRIM(COALESCE(vehicles.model_name, '')), ' ', ''), '-', '')"
const visibleDailyExpenseCondition = `
  COALESCE(REPLACE(REPLACE(REPLACE(REPLACE(note, ' ', ''), ',', ''), '/', ''), '-', ''), '') NOT LIKE '%카드수수료%'
  AND LOWER(COALESCE(REPLACE(REPLACE(REPLACE(REPLACE(note, ' ', ''), ',', ''), '/', ''), '-', ''), '')) NOT LIKE '%cardfee%'
`

function getPeriodLength(rangeMode: DashboardRangeMode) {
  switch (rangeMode) {
    case 'year':
      return 4
    case 'month':
      return 7
    case 'date':
    default:
      return 10
  }
}

function normalizeNumber(value: unknown) {
  return Number(value ?? 0)
}

function effectiveSaleTotalSql(tablePrefix = '') {
  const prefix = tablePrefix ? `${tablePrefix}.` : ''
  const paymentAmount = `COALESCE(${prefix}card_amount, 0) + COALESCE(${prefix}naver_amount, 0) + COALESCE(${prefix}cash_amount, 0)`
  return `CASE WHEN (${paymentAmount}) > 0 THEN (${paymentAmount}) ELSE COALESCE(${prefix}total_amount, 0) END`
}

function normalizeDiscountRate(value: unknown) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100))
}

function sortBreakdownRows(rows: DashboardBreakdownRow[]) {
  return [...rows].sort(
    (left, right) =>
      right.amount - left.amount ||
      right.quantity - left.quantity ||
      (left.patternName ?? '').localeCompare(right.patternName ?? '') ||
      left.label.localeCompare(right.label),
  )
}

function createEmptySummary(): DashboardSummary {
  return {
    salesCount: 0,
    totalAmount: 0,
    tireQuantity: 0,
    cardAmount: 0,
    naverAmount: 0,
    cashAmount: 0,
    cardFeeAmount: 0,
    serviceAmount: 0,
    tireSalesAmount: 0,
    tireCostAmount: 0,
    expenseAmount: 0,
    tireProfit: 0,
    netProfit: 0,
  }
}

function createEmptyInventoryMetrics(lowStockThreshold: number): DashboardInventoryMetrics {
  return {
    totalQuantity: 0,
    stockedItemCount: 0,
    lowStockThreshold,
    lowStockItemCount: 0,
  }
}

function createEmptyHeadlineMetrics(): DashboardHeadlineMetrics {
  return {
    previousQuantity: 0,
    todayQuantity: 0,
    cumulativeQuantity: 0,
    previousProfit: 0,
    todayProfit: 0,
    cumulativeProfit: 0,
  }
}

function standardizeSizeLabel(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return '미입력'
  }

  const compact = trimmed.replace(/\s+/g, ' ')
  const matchedDigits = compact.match(/(\d{2,3})\D*(\d{2,3})\D*(\d{2})/)
  if (matchedDigits) {
    return `${matchedDigits[1]} ${matchedDigits[2]} ${matchedDigits[3]}`
  }

  const digitsOnly = compact.replace(/\D/g, '')
  if (digitsOnly.length >= 7 && digitsOnly.length <= 8) {
    return `${digitsOnly.slice(0, 3)} ${digitsOnly.slice(3, -2)} ${digitsOnly.slice(-2)}`
  }

  return compact
}

async function ensureDashboardSchema() {
  if (!dashboardSchemaPromise) {
    dashboardSchemaPromise = (async () => {
      await ensureRuntimeReady()
      await execute(
        `CREATE TABLE IF NOT EXISTS daily_expenses (
          expense_date TEXT PRIMARY KEY,
          amount INTEGER NOT NULL DEFAULT 0,
          note TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      )
    })().catch((error) => {
      dashboardSchemaPromise = null
      throw error
    })
  }

  await dashboardSchemaPromise
}

async function loadDashboardPart<T>(
  label: string,
  load: () => Promise<T>,
  createFallback: () => T,
): Promise<DashboardLoadResult<T>> {
  try {
    return {
      value: await load(),
      warning: null,
    }
  } catch (error) {
    console.error(`Failed to load dashboard section: ${label}`, error)
    return {
      value: createFallback(),
      warning: `${label} 정보를 기본값으로 표시했습니다.`,
    }
  }
}

function buildSummary(
  salesRow: SummarySalesRow | null,
  linesRow: SummaryLinesRow | null,
  expenseRow: ExpenseSumRow | null,
): DashboardSummary {
  const tireSalesAmount = normalizeNumber(linesRow?.tireSalesAmount)
  const tireCostAmount = normalizeNumber(linesRow?.tireCostAmount)
  const serviceAmount = normalizeNumber(linesRow?.serviceAmount)
  const expenseAmount = normalizeNumber(expenseRow?.expenseAmount)
  const cardFeeAmount = normalizeNumber(salesRow?.cardFeeAmount)

  return {
    salesCount: normalizeNumber(salesRow?.salesCount),
    totalAmount: normalizeNumber(salesRow?.totalAmount),
    tireQuantity: normalizeNumber(linesRow?.tireQuantity),
    cardAmount: normalizeNumber(salesRow?.cardAmount),
    naverAmount: normalizeNumber(salesRow?.naverAmount),
    cashAmount: normalizeNumber(salesRow?.cashAmount),
    cardFeeAmount,
    serviceAmount,
    tireSalesAmount,
    tireCostAmount,
    expenseAmount,
    tireProfit: tireSalesAmount - tireCostAmount,
    netProfit: tireSalesAmount + serviceAmount - tireCostAmount - cardFeeAmount - expenseAmount,
  }
}

async function loadDiscountMaps() {
  const [brandRules, productRules] = await Promise.all([
    loadBrandDiscountRules(),
    loadProductDiscountRules(),
  ])

  return {
    brandDiscountMap: new Map(
      brandRules.map((rule) => [normalizeText(rule.brandName), normalizeDiscountRate(rule.discountRate)]),
    ),
    productDiscountMap: new Map(
      productRules.map((rule) => [normalizeText(rule.productName), normalizeDiscountRate(rule.discountRate)]),
    ),
  }
}

function buildSummaryLines(
  rows: SummaryLineCostRow[],
  brandDiscountMap: Map<string, number>,
  productDiscountMap: Map<string, number>,
): SummaryLinesRow {
  return rows.reduce<SummaryLinesRow>(
    (summary, row) => {
      const quantity = normalizeNumber(row.quantity)
      const lineTotal = normalizeNumber(row.lineTotal)

      if (row.lineType === 'tire') {
        const effectiveDiscountRate = Math.max(
          normalizeDiscountRate(row.defaultDiscountRate),
          brandDiscountMap.get(normalizeText(row.brandName)) ?? 0,
          productDiscountMap.get(normalizeText(row.patternName)) ?? 0,
          productDiscountMap.get(normalizeText(row.productName)) ?? 0,
        )
        const snapshotWholesalePrice = normalizeNumber(row.discountedUnitPriceSnapshot)
        const discountedCost =
          snapshotWholesalePrice > 0
            ? snapshotWholesalePrice
            : Math.round(normalizeNumber(row.costPriceSnapshot) * (100 - effectiveDiscountRate) / 100)

        summary.tireQuantity += quantity
        summary.tireSalesAmount += lineTotal
        summary.tireCostAmount += Math.max(0, discountedCost) * quantity
        return summary
      }

      if (row.lineType !== 'tire') {
        summary.serviceAmount += lineTotal
      }

      return summary
    },
    {
      tireQuantity: 0,
      tireSalesAmount: 0,
      tireCostAmount: 0,
      serviceAmount: 0,
    },
  )
}

async function loadSummary(rangeMode: DashboardRangeMode, value: string): Promise<DashboardSummary> {
  const periodLength = getPeriodLength(rangeMode)

  return loadSummaryByQuery(
    'SUBSTR(sold_at, 1, ?) = ?',
    [periodLength, value],
    'SUBSTR(sales.sold_at, 1, ?) = ?',
    [periodLength, value],
    'SUBSTR(expense_date, 1, ?) = ?',
    [periodLength, value],
  )
}

async function loadSummaryByQuery(
  salesWhereClause: string,
  salesBindValues: unknown[],
  lineWhereClause: string,
  lineBindValues: unknown[],
  expenseWhereClause: string,
  expenseBindValues: unknown[],
): Promise<DashboardSummary> {
  const [salesRow, lineRows, expenseRow, discountMaps] = await Promise.all([
    selectFirst<SummarySalesRow>(
      `SELECT
        COUNT(*) AS salesCount,
        COALESCE(SUM(${effectiveSaleTotalSql()}), 0) AS totalAmount,
        COALESCE(SUM(card_amount), 0) AS cardAmount,
        COALESCE(SUM(COALESCE(naver_amount, 0)), 0) AS naverAmount,
        COALESCE(SUM(cash_amount), 0) AS cashAmount,
        COALESCE(
          SUM(
            ROUND(COALESCE(card_amount, 0) * 0.03)
            + ROUND(COALESCE(naver_amount, 0) * 0.05)
          ),
          0
        ) AS cardFeeAmount
      FROM sales
      WHERE ${salesWhereClause}`,
      salesBindValues,
    ),
    selectRows<SummaryLineCostRow>(
      `SELECT
        sale_lines.line_type AS lineType,
        COALESCE(sale_lines.quantity, 0) AS quantity,
        COALESCE(sale_lines.line_total, 0) AS lineTotal,
        CASE
          WHEN COALESCE(sale_lines.cost_price_snapshot, 0) > 0 THEN COALESCE(sale_lines.cost_price_snapshot, 0)
          ELSE COALESCE(items.default_cost_price, 0)
        END AS costPriceSnapshot,
        COALESCE(sale_lines.discounted_unit_price_snapshot, 0) AS discountedUnitPriceSnapshot,
        COALESCE(items.brand_name, '') AS brandName,
        COALESCE(items.pattern_name, '') AS patternName,
        COALESCE(items.product_name, '') AS productName,
        COALESCE(items.default_discount_rate, 0) AS defaultDiscountRate
      FROM sale_lines
      INNER JOIN sales
        ON sales.id = sale_lines.sale_id
      LEFT JOIN items
        ON items.id = sale_lines.item_id
      WHERE ${lineWhereClause}`,
      lineBindValues,
    ),
    selectFirst<ExpenseSumRow>(
      `SELECT
        COALESCE(SUM(amount), 0) AS expenseAmount
      FROM daily_expenses
      WHERE ${expenseWhereClause}
        AND ${visibleDailyExpenseCondition}`,
      expenseBindValues,
    ),
    loadDiscountMaps(),
  ])

  const linesRow = buildSummaryLines(
    lineRows,
    discountMaps.brandDiscountMap,
    discountMaps.productDiscountMap,
  )

  return buildSummary(salesRow, linesRow, expenseRow)
}

async function loadHeadlineMetrics(todayValue: string, todaySummary: DashboardSummary): Promise<DashboardHeadlineMetrics> {
  const [previousSummary, cumulativeSummary] = await Promise.all([
    loadSummaryByQuery(
      'SUBSTR(sold_at, 1, 10) < ?',
      [todayValue],
      'SUBSTR(sales.sold_at, 1, 10) < ?',
      [todayValue],
      'expense_date < ?',
      [todayValue],
    ),
    loadSummaryByQuery(
      'SUBSTR(sold_at, 1, 10) <= ?',
      [todayValue],
      'SUBSTR(sales.sold_at, 1, 10) <= ?',
      [todayValue],
      'expense_date <= ?',
      [todayValue],
    ),
  ])

  return {
    previousQuantity: previousSummary.tireQuantity,
    todayQuantity: todaySummary.tireQuantity,
    cumulativeQuantity: cumulativeSummary.tireQuantity,
    previousProfit: previousSummary.netProfit,
    todayProfit: todaySummary.netProfit,
    cumulativeProfit: cumulativeSummary.netProfit,
  }
}

async function loadBrandBreakdown(rangeMode: DashboardRangeMode, value: string) {
  const periodLength = getPeriodLength(rangeMode)
  const rows = await selectRows<DashboardBreakdownRow>(
    `SELECT
      COALESCE(items.brand_name, '기타') AS label,
      COALESCE(SUM(sale_lines.quantity), 0) AS quantity,
      COALESCE(SUM(sale_lines.line_total), 0) AS amount
    FROM sale_lines
    INNER JOIN sales
      ON sales.id = sale_lines.sale_id
    LEFT JOIN items
      ON items.id = sale_lines.item_id
    WHERE sale_lines.line_type = 'tire'
      AND SUBSTR(sales.sold_at, 1, ?) = ?
    GROUP BY COALESCE(items.brand_name, '기타')`,
    [periodLength, value],
  )

  return sortBreakdownRows(
    rows.map((row) => ({
      label: row.label,
      quantity: normalizeNumber(row.quantity),
      amount: normalizeNumber(row.amount),
    })),
  )
}

async function loadSizeBreakdown(rangeMode: DashboardRangeMode, value: string) {
  const periodLength = getPeriodLength(rangeMode)
  const rows = await selectRows<RawSizeBreakdownRow>(
    `SELECT
      COALESCE(NULLIF(items.size_label, ''), NULLIF(sale_lines.size_snapshot, ''), '미입력') AS sizeLabel,
      COALESCE(NULLIF(items.pattern_name, ''), NULLIF(sale_lines.item_snapshot_name, ''), '미입력') AS patternName,
      sale_lines.quantity AS quantity,
      sale_lines.line_total AS amount
    FROM sale_lines
    INNER JOIN sales
      ON sales.id = sale_lines.sale_id
    LEFT JOIN items
      ON items.id = sale_lines.item_id
    WHERE sale_lines.line_type = 'tire'
      AND SUBSTR(sales.sold_at, 1, ?) = ?`,
    [periodLength, value],
  )

  const aggregated = new Map<string, DashboardBreakdownRow>()
  for (const row of rows) {
    const label = standardizeSizeLabel(row.sizeLabel)
    const patternName = row.patternName?.trim() || '미입력'
    const key = `${patternName}\u0000${label}`
    const current = aggregated.get(key) ?? { label, patternName, quantity: 0, amount: 0 }
    current.quantity += normalizeNumber(row.quantity)
    current.amount += normalizeNumber(row.amount)
    aggregated.set(key, current)
  }

  return sortBreakdownRows([...aggregated.values()])
}

async function loadRecentSales(rangeMode: DashboardRangeMode, value: string) {
  const periodLength = getPeriodLength(rangeMode)
  const rows = await selectRows<DashboardRecentSaleRow>(
    `SELECT
      sales.id AS id,
      sales.sold_at AS soldAt,
      CASE
        WHEN TRIM(COALESCE(vehicles.plate_number, '')) <> '' THEN TRIM(vehicles.plate_number)
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
          AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
          THEN TRIM(COALESCE(vehicles.model_name, ''))
        ELSE '-'
      END AS plateNumber,
      COALESCE(NULLIF(customers.name, ''), '미등록 고객') AS customerName,
      ${effectiveSaleTotalSql('sales')} AS totalAmount,
      COALESCE(sales.card_amount, 0) AS cardAmount,
      COALESCE(sales.naver_amount, 0) AS naverAmount,
      COALESCE(sales.cash_amount, 0) AS cashAmount,
      COALESCE(SUM(CASE WHEN sale_lines.line_type = 'tire' THEN sale_lines.quantity ELSE 0 END), 0) AS tireQuantity
    FROM sales
    LEFT JOIN customers
      ON customers.id = sales.customer_id
    LEFT JOIN vehicles
      ON vehicles.id = sales.vehicle_id
    LEFT JOIN sale_lines
      ON sale_lines.sale_id = sales.id
    WHERE SUBSTR(sales.sold_at, 1, ?) = ?
    GROUP BY sales.id
    ORDER BY sales.sold_at DESC, sales.id DESC`,
    [periodLength, value],
  )

  return rows.map((row) => ({
    id: normalizeNumber(row.id),
    soldAt: row.soldAt,
    plateNumber: row.plateNumber,
    customerName: row.customerName,
    totalAmount: normalizeNumber(row.totalAmount),
    cardAmount: normalizeNumber(row.cardAmount),
    naverAmount: normalizeNumber(row.naverAmount),
    cashAmount: normalizeNumber(row.cashAmount),
    tireQuantity: normalizeNumber(row.tireQuantity),
  }))
}

async function loadInventoryMetrics(lowStockThreshold: number): Promise<DashboardInventoryMetrics> {
  const row = await selectFirst<InventoryMetricsRow>(
    `SELECT
      COALESCE(SUM(COALESCE(inventory_balance_cache.quantity_on_hand, 0)), 0) AS totalQuantity,
      COALESCE(SUM(CASE WHEN COALESCE(inventory_balance_cache.quantity_on_hand, 0) > 0 THEN 1 ELSE 0 END), 0) AS stockedItemCount,
      COALESCE(
        SUM(
          CASE
            WHEN COALESCE(inventory_balance_cache.quantity_available, 0) > 0
              AND COALESCE(inventory_balance_cache.quantity_available, 0) <= ?
            THEN 1
            ELSE 0
          END
        ),
        0
      ) AS lowStockItemCount
    FROM items
    LEFT JOIN inventory_balance_cache
      ON inventory_balance_cache.item_id = items.id
    WHERE items.is_active = 1`,
    [lowStockThreshold],
  )

  return {
    totalQuantity: normalizeNumber(row?.totalQuantity),
    stockedItemCount: normalizeNumber(row?.stockedItemCount),
    lowStockThreshold,
    lowStockItemCount: normalizeNumber(row?.lowStockItemCount),
  }
}

async function loadLowStockItems(lowStockThreshold: number) {
  const rows = await selectRows<DashboardLowStockRow>(
    `SELECT
      items.id AS itemId,
      items.brand_name AS brandName,
      items.pattern_name AS patternName,
      items.size_label AS sizeLabel,
      COALESCE(inventory_balance_cache.quantity_available, 0) AS quantityAvailable
    FROM items
    LEFT JOIN inventory_balance_cache
      ON inventory_balance_cache.item_id = items.id
    WHERE items.is_active = 1
      AND COALESCE(inventory_balance_cache.quantity_available, 0) > 0
      AND COALESCE(inventory_balance_cache.quantity_available, 0) <= ?
    ORDER BY
      COALESCE(inventory_balance_cache.quantity_available, 0) ASC,
      items.normalized_brand ASC,
      items.normalized_size ASC,
      items.normalized_pattern ASC
    LIMIT 12`,
    [lowStockThreshold],
  )

  return rows.map((row) => ({
    itemId: normalizeNumber(row.itemId),
    brandName: row.brandName,
    patternName: row.patternName,
    sizeLabel: standardizeSizeLabel(row.sizeLabel),
    quantityAvailable: normalizeNumber(row.quantityAvailable),
  }))
}

async function loadPeriodBuckets(rangeMode: DashboardRangeMode, value: string) {
  const periodLength = getPeriodLength(rangeMode)
  const labelLength = rangeMode === 'year' ? 7 : 10
  const rows = await selectRows<DashboardPeriodBucketRow>(
    `WITH filtered_sales AS (
      SELECT
        id,
        sold_at,
        ${effectiveSaleTotalSql()} AS total_amount,
        card_amount,
        COALESCE(naver_amount, 0) AS naverAmount,
        cash_amount
      FROM sales
      WHERE SUBSTR(sold_at, 1, ?) = ?
    ),
    tire_totals AS (
      SELECT
        sale_id,
        COALESCE(SUM(CASE WHEN line_type = 'tire' THEN quantity ELSE 0 END), 0) AS quantity,
        COALESCE(SUM(CASE WHEN line_type = 'tire' THEN line_total ELSE 0 END), 0) AS amount
      FROM sale_lines
      WHERE sale_id IN (SELECT id FROM filtered_sales)
      GROUP BY sale_id
    )
    SELECT
      SUBSTR(filtered_sales.sold_at, 1, ?) AS label,
      COUNT(*) AS salesCount,
      COALESCE(SUM(COALESCE(tire_totals.quantity, 0)), 0) AS quantity,
      COALESCE(SUM(COALESCE(tire_totals.amount, 0)), 0) AS amount,
      COALESCE(SUM(filtered_sales.total_amount), 0) AS totalAmount,
      COALESCE(SUM(filtered_sales.card_amount), 0) AS cardAmount,
      COALESCE(SUM(filtered_sales.naverAmount), 0) AS naverAmount,
      COALESCE(SUM(filtered_sales.cash_amount), 0) AS cashAmount
    FROM filtered_sales
    LEFT JOIN tire_totals
      ON tire_totals.sale_id = filtered_sales.id
    GROUP BY SUBSTR(filtered_sales.sold_at, 1, ?)
    ORDER BY SUBSTR(filtered_sales.sold_at, 1, ?) DESC`,
    [periodLength, value, labelLength, labelLength, labelLength],
  )

  return rows.map((row) => ({
    label: row.label,
    salesCount: normalizeNumber(row.salesCount),
    quantity: normalizeNumber(row.quantity),
    amount: normalizeNumber(row.amount),
    totalAmount: normalizeNumber(row.totalAmount),
    cardAmount: normalizeNumber(row.cardAmount),
    naverAmount: normalizeNumber(row.naverAmount),
    cashAmount: normalizeNumber(row.cashAmount),
  }))
}

function getGroupedLabel(rangeMode: DashboardRangeMode) {
  switch (rangeMode) {
    case 'year':
      return '월별 집계'
    case 'month':
      return '일자별 집계'
    case 'date':
    default:
      return '선택 날짜 집계'
  }
}

function buildValidation(
  rangeMode: DashboardRangeMode,
  periodSummary: DashboardSummary,
  brandRows: DashboardBreakdownRow[],
  sizeRows: DashboardBreakdownRow[],
  periodBuckets: DashboardPeriodBucketRow[],
): DashboardValidation {
  const groupedQuantity = periodBuckets.reduce((sum, row) => sum + row.quantity, 0)
  const brandQuantity = brandRows.reduce((sum, row) => sum + row.quantity, 0)
  const sizeQuantity = sizeRows.reduce((sum, row) => sum + row.quantity, 0)

  return {
    periodTireQuantity: periodSummary.tireQuantity,
    groupedLabel: getGroupedLabel(rangeMode),
    groupedQuantity,
    brandQuantity,
    sizeQuantity,
    groupedMatches: periodSummary.tireQuantity === groupedQuantity,
    brandMatches: periodSummary.tireQuantity === brandQuantity,
    sizeMatches: periodSummary.tireQuantity === sizeQuantity,
  }
}

export function getTodayValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '00'
  const day = parts.find((part) => part.type === 'day')?.value ?? '00'

  return `${year}-${month}-${day}`
}

export function getCurrentMonthValue() {
  return getTodayValue().slice(0, 7)
}

export function getCurrentYearValue() {
  return getTodayValue().slice(0, 4)
}

export async function loadDailyExpense(expenseDate: string): Promise<DashboardExpenseRecord> {
  await ensureDashboardSchema()

  const row = await selectFirst<DailyExpenseRow>(
    `SELECT
      expense_date AS expenseDate,
      amount AS amount,
      note AS note,
      updated_at AS updatedAt
    FROM daily_expenses
      WHERE expense_date = ?
      AND ${visibleDailyExpenseCondition}
    LIMIT 1`,
    [expenseDate],
  )

  return {
    expenseDate,
    amount: normalizeNumber(row?.amount),
    note: row?.note ?? '',
    updatedAt: row?.updatedAt ?? null,
  }
}

export async function loadDailyExpenseHistory(
  rangeMode: DashboardRangeMode,
  value: string,
): Promise<DashboardExpenseHistoryRow[]> {
  await ensureDashboardSchema()

  const periodLength = getPeriodLength(rangeMode)
  const rows = await selectRows<DailyExpenseRow>(
    `SELECT
      expense_date AS expenseDate,
      amount AS amount,
      note AS note,
      updated_at AS updatedAt
    FROM daily_expenses
    WHERE SUBSTR(expense_date, 1, ?) = ?
      AND ${visibleDailyExpenseCondition}
    ORDER BY expense_date DESC, updated_at DESC`,
    [periodLength, value],
  )

  return rows.map((row) => ({
    expenseDate: row.expenseDate,
    amount: normalizeNumber(row.amount),
    note: row.note ?? '',
    updatedAt: row.updatedAt ?? null,
  }))
}

export async function saveDailyExpense(input: DashboardExpenseInput) {
  await ensureDashboardSchema()

  const expenseDate = input.expenseDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    throw new Error('지출 날짜를 다시 확인해 주세요.')
  }

  const amount = Math.max(0, Math.round(Number(input.amount) || 0))
  const note = input.note.trim()

  if (amount === 0 && !note) {
    await execute('DELETE FROM daily_expenses WHERE expense_date = ?', [expenseDate])
    return
  }

  await execute(
    `INSERT INTO daily_expenses (
      expense_date,
      amount,
      note,
      updated_at
    ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(expense_date) DO UPDATE SET
      amount = excluded.amount,
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP`,
    [expenseDate, amount, note],
  )
}

export async function appendDailyExpense(input: DashboardExpenseInput) {
  await ensureDashboardSchema()

  const expenseDate = input.expenseDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    throw new Error('지출 날짜를 다시 확인해 주세요.')
  }

  const amountToAdd = Math.max(0, Math.round(Number(input.amount) || 0))
  const noteToAdd = input.note.trim()
  if (amountToAdd === 0 && !noteToAdd) {
    throw new Error('추가할 지출 금액이나 비고를 입력해 주세요.')
  }

  const current = await loadDailyExpense(expenseDate)
  const nextAmount = Math.max(0, current.amount + amountToAdd)
  const nextNote =
    current.note.trim() && noteToAdd
      ? `${current.note.trim()} / ${noteToAdd}`
      : current.note.trim() || noteToAdd

  await saveDailyExpense({
    expenseDate,
    amount: nextAmount,
    note: nextNote,
  })
}

export async function deleteDailyExpense(expenseDate: string) {
  await ensureDashboardSchema()

  const trimmedExpenseDate = expenseDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedExpenseDate)) {
    throw new Error('지출 날짜를 다시 확인해 주세요.')
  }

  await execute('DELETE FROM daily_expenses WHERE expense_date = ?', [trimmedExpenseDate])
}

export async function saveLowStockThreshold(threshold: number) {
  await ensureRuntimeReady()
  await saveLowStockThresholdSetting(threshold)
}

export async function loadDashboardAnalytics(rangeMode: DashboardRangeMode, value: string): Promise<DashboardAnalytics> {
  await ensureDashboardSchema()

  const todayValue = getTodayValue()
  const focusDateValue = rangeMode === 'date' ? value : todayValue
  const lowStockThresholdResult = await loadDashboardPart(
    '저재고 기준',
    () => loadLowStockThresholdSetting(),
    () => DEFAULT_LOW_STOCK_THRESHOLD,
  )
  const lowStockThreshold = lowStockThresholdResult.value

  const [todayResult, periodResult, inventoryResult, brandRowsResult, sizeRowsResult, lowStockItemsResult, periodBucketsResult, recentSalesResult] =
    await Promise.all([
      loadDashboardPart('기준일 요약', () => loadSummary('date', focusDateValue), createEmptySummary),
      loadDashboardPart('기간 요약', () => loadSummary(rangeMode, value), createEmptySummary),
      loadDashboardPart(
        '재고 지표',
        () => loadInventoryMetrics(lowStockThreshold),
        () => createEmptyInventoryMetrics(lowStockThreshold),
      ),
      loadDashboardPart('브랜드 분석', () => loadBrandBreakdown(rangeMode, value), () => []),
      loadDashboardPart('규격 분석', () => loadSizeBreakdown(rangeMode, value), () => []),
      loadDashboardPart('저재고 목록', () => loadLowStockItems(lowStockThreshold), () => []),
      loadDashboardPart('기간별 집계', () => loadPeriodBuckets(rangeMode, value), () => []),
      loadDashboardPart('최근 판매', () => loadRecentSales(rangeMode, value), () => []),
    ])
  const headlineResult = await loadDashboardPart(
    '상단 누계',
    () => loadHeadlineMetrics(focusDateValue, todayResult.value),
    createEmptyHeadlineMetrics,
  )

  const warnings = [
    lowStockThresholdResult.warning,
    todayResult.warning,
    headlineResult.warning,
    periodResult.warning,
    inventoryResult.warning,
    brandRowsResult.warning,
    sizeRowsResult.warning,
    lowStockItemsResult.warning,
    periodBucketsResult.warning,
    recentSalesResult.warning,
  ].filter((warning): warning is string => Boolean(warning))

  const period = periodResult.value
  const brandRows = brandRowsResult.value
  const sizeRows = sizeRowsResult.value
  const periodBuckets = periodBucketsResult.value

  return {
    headline: headlineResult.value,
    today: todayResult.value,
    period,
    inventory: inventoryResult.value,
    topBrands: brandRows.slice(0, 8),
    topSizes: sizeRows.slice(0, 8),
    lowStockItems: lowStockItemsResult.value,
    periodBuckets,
    validation: buildValidation(rangeMode, period, brandRows, sizeRows, periodBuckets),
    recentSales: recentSalesResult.value,
    warnings,
  }
}

