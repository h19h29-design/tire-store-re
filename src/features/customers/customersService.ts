import { execute, selectFirst, selectRows } from '../../lib/db'
import { normalizePhone, normalizePlate, normalizeText } from '../../lib/normalize'
import type {
  CustomerFilterOptions,
  CustomerListRow,
  CustomerRecordUpdateInput,
  CustomerSearchFilters,
  CustomerVisitRow,
} from '../../lib/types'

const defaultFilters: CustomerSearchFilters = {
  query: '',
  vehicleBrand: '',
  vehicleModel: '',
  purchasedBrand: '',
  saleStatus: 'all',
}

const legacyVehiclePlateSql = "REPLACE(REPLACE(TRIM(COALESCE(vehicles.model_name, '')), ' ', ''), '-', '')"
const legacyVehiclePlateValueSql = "REPLACE(REPLACE(TRIM(COALESCE(model_name, '')), ' ', ''), '-', '')"

function effectiveSaleTotalSql(tablePrefix = '') {
  const prefix = tablePrefix ? `${tablePrefix}.` : ''
  const paymentAmount = `COALESCE(${prefix}card_amount, 0) + COALESCE(${prefix}naver_amount, 0) + COALESCE(${prefix}cash_amount, 0)`
  return `CASE WHEN (${paymentAmount}) > 0 THEN (${paymentAmount}) ELSE COALESCE(${prefix}total_amount, 0) END`
}

type VehicleEditContextRow = {
  id: number
  customerId: number | null
  plateNumber: string
  normalizedPlateNumber: string
  brandName: string
  modelName: string
  odometer: number
  memo: string
  legacyPlateKey: string
}

type CustomerVisitLineRow = {
  saleId: number
  soldAt: string
  plateNumber: string
  vehicleModel: string
  totalAmount: number
  cardAmount: number
  cashAmount: number
  naverAmount: number
  saleMemo: string
  lineId: number | null
  lineType: string | null
  itemSnapshotName: string | null
  sizeSnapshot: string | null
  quantity: number | null
  lineTotal: number | null
  lineMemo: string | null
  brandName: string | null
  patternName: string | null
  sizeLabel: string | null
}

type CustomerOrphanWorkRow = {
  workLogId: number
  soldAt: string
  plateNumber: string
  vehicleModel: string
  workType: string
  amount: number
  memo: string
}

const latestSaleLineSummaryExpression = `TRIM(
  CASE
    WHEN sale_lines.line_type = 'tire' THEN
      COALESCE(
        NULLIF(
          TRIM(
            COALESCE(
              NULLIF(
                CASE
                  WHEN sale_lines.item_id IS NOT NULL THEN
                    TRIM(COALESCE(items.brand_name, '') || ' ' || COALESCE(items.pattern_name, ''))
                  ELSE COALESCE(sale_lines.item_snapshot_name, '')
                END,
                ''
              ),
              '타이어'
            ) ||
            CASE
              WHEN COALESCE(NULLIF(items.size_label, ''), NULLIF(sale_lines.size_snapshot, ''), '') = '' THEN ''
              ELSE ' ' || COALESCE(NULLIF(items.size_label, ''), NULLIF(sale_lines.size_snapshot, ''), '')
            END
          ),
          ''
        ),
        '타이어'
      )
    ELSE
      COALESCE(
        NULLIF(
          TRIM(
            COALESCE(
              NULLIF(sale_lines.item_snapshot_name, ''),
              CASE
                WHEN sale_lines.line_type = 'used' THEN '중고'
                WHEN sale_lines.line_type = 'wheel' THEN '휠'
                ELSE '추가 작업'
              END
            ) ||
            CASE
              WHEN NULLIF(sale_lines.size_snapshot, '') IS NULL THEN ''
              ELSE ' ' || sale_lines.size_snapshot
            END
          ),
          ''
        ),
        '추가 작업'
      )
  END
)`

function formatAmountLabel(amount: number) {
  return amount > 0 ? `${amount.toLocaleString('ko-KR')}원` : ''
}

function getLineWorkLabel(row: CustomerVisitLineRow) {
  const quantity = Number(row.quantity ?? 0)
  const amount = Number(row.lineTotal ?? 0)
  const sizeLabel = (row.sizeLabel || row.sizeSnapshot || '').trim()
  const productLabel =
    row.lineType === 'tire'
      ? [row.brandName, row.patternName].filter(Boolean).join(' ').trim() || (row.itemSnapshotName || '타이어').trim()
      : (row.itemSnapshotName || (row.lineType === 'wheel' ? '휠' : row.lineType === 'used' ? '중고' : '추가 작업')).trim()
  const pieces = [
    row.lineType === 'tire' ? `타이어 ${productLabel}` : productLabel,
    sizeLabel,
    row.lineType === 'tire' && quantity > 0 ? `${quantity.toLocaleString('ko-KR')}개` : '',
    formatAmountLabel(amount),
  ].filter(Boolean)
  return pieces.join(' / ')
}

function getWorkLogLabel(row: CustomerOrphanWorkRow) {
  return [row.workType || '작업', formatAmountLabel(Number(row.amount ?? 0)), row.memo || ''].filter(Boolean).join(' / ')
}

function buildCustomerSearchQuery(whereClause: string) {
  return `WITH recent_sale_dates AS (
      SELECT
        sales.vehicle_id AS vehicleId,
        MAX(sales.sold_at) AS latestSaleAt
      FROM sales
      WHERE sales.vehicle_id IS NOT NULL
      GROUP BY sales.vehicle_id
    ),
    candidate_vehicles AS (
      SELECT
        vehicles.id AS vehicleId,
        recent_sale_dates.latestSaleAt AS latestSaleAt
      FROM vehicles
      LEFT JOIN customers
        ON customers.id = vehicles.customer_id
      LEFT JOIN recent_sale_dates
        ON recent_sale_dates.vehicleId = vehicles.id
      WHERE ${whereClause}
      ORDER BY
        CASE WHEN COALESCE(recent_sale_dates.latestSaleAt, '') = '' THEN 1 ELSE 0 END,
        COALESCE(recent_sale_dates.latestSaleAt, '') DESC,
        CASE
          WHEN TRIM(
            CASE
              WHEN TRIM(COALESCE(vehicles.plate_number, '')) <> '' THEN TRIM(vehicles.plate_number)
              WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
                AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
                AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
                THEN TRIM(COALESCE(vehicles.model_name, ''))
              ELSE ''
            END
          ) = '' THEN 1 ELSE 0
        END,
        vehicles.normalized_plate_number ASC,
        vehicles.id DESC
      LIMIT 300
    ),
    sale_totals AS (
      SELECT
        sales.vehicle_id AS vehicleId,
        COUNT(*) AS visitCount,
        MAX(sales.sold_at) AS latestSaleAt
      FROM sales
      INNER JOIN candidate_vehicles
        ON candidate_vehicles.vehicleId = sales.vehicle_id
      WHERE sales.vehicle_id IS NOT NULL
      GROUP BY sales.vehicle_id
    ),
    alignment_totals AS (
      SELECT
        work_logs.vehicle_id AS vehicleId,
        COALESCE(SUM(work_logs.amount), 0) AS alignmentAmount
      FROM work_logs
      INNER JOIN candidate_vehicles
        ON candidate_vehicles.vehicleId = work_logs.vehicle_id
      WHERE work_logs.vehicle_id IS NOT NULL
        AND (
          LOWER(work_logs.work_type) LIKE '%alignment%'
          OR work_logs.work_type LIKE '%얼라이%'
          OR LOWER(COALESCE(work_logs.memo, '')) LIKE '%alignment%'
          OR COALESCE(work_logs.memo, '') LIKE '%얼라이%'
        )
      GROUP BY work_logs.vehicle_id
    ),
    latest_sales AS (
      SELECT
        candidate_vehicles.vehicleId AS vehicleId,
        sales.id AS saleId,
        ${effectiveSaleTotalSql('sales')} AS totalSaleAmount,
        COALESCE(sales.card_amount, 0) AS cardAmount,
        COALESCE(sales.naver_amount, 0) AS naverAmount,
        COALESCE(sales.cash_amount, 0) AS cashAmount,
        sales.memo AS saleMemo
      FROM candidate_vehicles
      LEFT JOIN sales
        ON sales.id = (
          SELECT sales_latest.id
          FROM sales sales_latest
          WHERE sales_latest.vehicle_id = candidate_vehicles.vehicleId
          ORDER BY sales_latest.sold_at DESC, sales_latest.id DESC
          LIMIT 1
        )
    ),
    latest_sale_lines AS (
      SELECT
        latest_sales.vehicleId AS vehicleId,
        COALESCE(SUM(CASE WHEN sale_lines.line_type = 'tire' THEN sale_lines.quantity ELSE 0 END), 0) AS saleQuantity,
        COALESCE(
          GROUP_CONCAT(
            CASE
              WHEN sale_lines.id IS NULL THEN NULL
              ELSE ${latestSaleLineSummaryExpression}
            END,
            ', '
          ),
          ''
        ) AS latestTireSummary
      FROM latest_sales
      LEFT JOIN sale_lines
        ON sale_lines.sale_id = latest_sales.saleId
      LEFT JOIN items
        ON items.id = sale_lines.item_id
      GROUP BY latest_sales.vehicleId
    )
    SELECT
      vehicles.id AS id,
      customers.id AS customerId,
      CASE
        WHEN TRIM(COALESCE(vehicles.plate_number, '')) <> '' THEN TRIM(vehicles.plate_number)
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
          AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
          THEN TRIM(COALESCE(vehicles.model_name, ''))
        ELSE ''
      END AS plateNumber,
      COALESCE(customers.name, '') AS customerName,
      COALESCE(customers.phone, '') AS phone,
      COALESCE(vehicles.brand_name, '') AS vehicleBrand,
      CASE
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
          AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
          THEN ''
        ELSE COALESCE(vehicles.model_name, '')
      END AS vehicleModel,
      COALESCE(vehicles.odometer, 0) AS odometer,
      COALESCE(latest_sale_lines.saleQuantity, 0) AS saleQuantity,
      COALESCE(sale_totals.visitCount, 0) AS visitCount,
      COALESCE(latest_sales.totalSaleAmount, 0) AS totalSaleAmount,
      COALESCE(latest_sales.cardAmount, 0) AS cardAmount,
      COALESCE(latest_sales.naverAmount, 0) AS naverAmount,
      COALESCE(latest_sales.cashAmount, 0) AS cashAmount,
      COALESCE(alignment_totals.alignmentAmount, 0) AS alignmentAmount,
      sale_totals.latestSaleAt AS latestSaleAt,
      COALESCE(latest_sale_lines.latestTireSummary, '') AS latestTireSummary,
      COALESCE(
        NULLIF(
          CASE
            WHEN LOWER(COALESCE(latest_sales.saleMemo, '')) LIKE 'imported %' THEN ''
            ELSE COALESCE(latest_sales.saleMemo, '')
          END,
          ''
        ),
        NULLIF(
          CASE
            WHEN LOWER(COALESCE(vehicles.memo, '')) LIKE 'imported %' THEN ''
            ELSE COALESCE(vehicles.memo, '')
          END,
          ''
        ),
        NULLIF(
          CASE
            WHEN LOWER(COALESCE(customers.memo, '')) LIKE 'imported %' THEN ''
            ELSE COALESCE(customers.memo, '')
          END,
          ''
        ),
        ''
      ) AS memo
    FROM candidate_vehicles
    INNER JOIN vehicles
      ON vehicles.id = candidate_vehicles.vehicleId
    LEFT JOIN customers
      ON customers.id = vehicles.customer_id
    LEFT JOIN sale_totals
      ON sale_totals.vehicleId = vehicles.id
    LEFT JOIN alignment_totals
      ON alignment_totals.vehicleId = vehicles.id
    LEFT JOIN latest_sales
      ON latest_sales.vehicleId = vehicles.id
    LEFT JOIN latest_sale_lines
      ON latest_sale_lines.vehicleId = vehicles.id
    ORDER BY
      CASE WHEN COALESCE(candidate_vehicles.latestSaleAt, '') = '' THEN 1 ELSE 0 END,
      COALESCE(candidate_vehicles.latestSaleAt, '') DESC,
      CASE
        WHEN TRIM(
          CASE
            WHEN TRIM(COALESCE(vehicles.plate_number, '')) <> '' THEN TRIM(vehicles.plate_number)
            WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
              AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
              AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
              THEN TRIM(COALESCE(vehicles.model_name, ''))
            ELSE ''
          END
        ) = '' THEN 1 ELSE 0
      END,
      vehicles.normalized_plate_number ASC,
      vehicles.id DESC`
}

async function loadCustomerVehicleRecord(vehicleId: number) {
  const rows = await selectRows<CustomerListRow>(`${buildCustomerSearchQuery('vehicles.id = ?')} LIMIT 1`, [vehicleId])
  return rows[0] ?? null
}

async function loadVehicleEditContext(vehicleId: number) {
  return selectFirst<VehicleEditContextRow>(
    `SELECT
      id,
      customer_id AS customerId,
      COALESCE(plate_number, '') AS plateNumber,
      COALESCE(normalized_plate_number, '') AS normalizedPlateNumber,
      COALESCE(brand_name, '') AS brandName,
      COALESCE(model_name, '') AS modelName,
      COALESCE(odometer, 0) AS odometer,
      COALESCE(memo, '') AS memo,
      CASE
        WHEN COALESCE(normalized_plate_number, '') = ''
          AND LENGTH(${legacyVehiclePlateValueSql}) BETWEEN 7 AND 8
          AND ${legacyVehiclePlateValueSql} GLOB '*[0-9]*'
          THEN ${legacyVehiclePlateValueSql}
        ELSE ''
      END AS legacyPlateKey
    FROM vehicles
    WHERE id = ?
    LIMIT 1`,
    [vehicleId],
  )
}

async function loadLinkedVehicleIds(canonicalPlate: string, fallbackVehicleId: number) {
  if (!canonicalPlate) {
    return [fallbackVehicleId]
  }

  const rows = await selectRows<{ id: number }>(
    `SELECT id
    FROM vehicles
    WHERE normalized_plate_number = ?
      OR (
        COALESCE(normalized_plate_number, '') = ''
        AND LENGTH(${legacyVehiclePlateValueSql}) BETWEEN 7 AND 8
        AND ${legacyVehiclePlateValueSql} GLOB '*[0-9]*'
        AND ${legacyVehiclePlateValueSql} = ?
      )
    ORDER BY id ASC`,
    [canonicalPlate, canonicalPlate],
  )

  const uniqueIds = [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0))]
  return uniqueIds.length > 0 ? uniqueIds : [fallbackVehicleId]
}

async function resolveCustomerVisitScope(vehicleId: number, customerId: number | null) {
  const currentVehicle = await loadVehicleEditContext(vehicleId)
  const scopedCustomerId = Number(customerId ?? currentVehicle?.customerId ?? 0)
  const resolvedCustomerId = Number.isInteger(scopedCustomerId) && scopedCustomerId > 0 ? scopedCustomerId : null
  const canonicalPlate =
    normalizePlate(currentVehicle?.plateNumber ?? '') ||
    currentVehicle?.normalizedPlateNumber ||
    currentVehicle?.legacyPlateKey ||
    ''
  const whereClauses = ['vehicles.id = ?']
  const bindValues: unknown[] = [vehicleId]

  if (resolvedCustomerId) {
    whereClauses.push('vehicles.customer_id = ?')
    bindValues.push(resolvedCustomerId)
  }

  if (canonicalPlate) {
    whereClauses.push(`(
      vehicles.normalized_plate_number = ?
      OR (
        COALESCE(vehicles.normalized_plate_number, '') = ''
        AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
        AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
        AND ${legacyVehiclePlateSql} = ?
      )
    )`)
    bindValues.push(canonicalPlate, canonicalPlate)
  }

  const rows = await selectRows<{ id: number }>(
    `SELECT DISTINCT vehicles.id AS id
    FROM vehicles
    WHERE ${whereClauses.map((clause) => `(${clause})`).join(' OR ')}
    ORDER BY vehicles.id ASC`,
    bindValues,
  )
  const vehicleIds = [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0))]
  return {
    customerId: resolvedCustomerId,
    vehicleIds: vehicleIds.length > 0 ? vehicleIds : [vehicleId],
  }
}

export async function searchCustomers(filters: Partial<CustomerSearchFilters> = {}) {
  const mergedFilters = { ...defaultFilters, ...filters }
  const rawQuery = mergedFilters.query.trim()
  const normalizedTextQuery = normalizeText(rawQuery)
  const normalizedPhoneQuery = normalizePhone(rawQuery)
  const normalizedPlateQuery = normalizePlate(rawQuery)
  const queryClauses: string[] = []
  const queryBindValues: string[] = []

  if (normalizedPlateQuery.length >= 1) {
    queryClauses.push(`(vehicles.normalized_plate_number LIKE ? OR ${legacyVehiclePlateSql} LIKE ?)`)
    queryBindValues.push(`%${normalizedPlateQuery}%`, `%${normalizedPlateQuery}%`)
  }

  if (normalizedPhoneQuery.length >= 1) {
    queryClauses.push("(customers.normalized_phone LIKE ? OR REPLACE(COALESCE(customers.phone, ''), '-', '') LIKE ?)")
    queryBindValues.push(`%${normalizedPhoneQuery}%`, `%${normalizedPhoneQuery}%`)
  }

  if (normalizedTextQuery.length >= 1) {
    queryClauses.push(
      "(LOWER(customers.name) LIKE '%' || LOWER(?) || '%' OR LOWER(vehicles.model_name) LIKE '%' || LOWER(?) || '%' OR LOWER(vehicles.brand_name) LIKE '%' || LOWER(?) || '%')",
    )
    queryBindValues.push(rawQuery, rawQuery, rawQuery)
  }

  const whereClause = queryClauses.length > 0 ? `(${queryClauses.join(' OR ')})` : '1 = 1'
  return selectRows<CustomerListRow>(`${buildCustomerSearchQuery(whereClause)} LIMIT 300`, queryBindValues)
}

export async function loadCustomerVisits(vehicleId: number, customerId: number | null = null): Promise<CustomerVisitRow[]> {
  const scope = await resolveCustomerVisitScope(vehicleId, customerId)
  const vehiclePlaceholders = scope.vehicleIds.map(() => '?').join(', ')
  const saleWhereParts = [`sales.vehicle_id IN (${vehiclePlaceholders})`]
  const saleBindValues: unknown[] = [...scope.vehicleIds]
  const workWhereParts = [`work_logs.vehicle_id IN (${vehiclePlaceholders})`]
  const workBindValues: unknown[] = [...scope.vehicleIds]

  if (scope.customerId) {
    saleWhereParts.push('sales.customer_id = ?')
    saleBindValues.push(scope.customerId)
    workWhereParts.push('work_logs.customer_id = ?')
    workBindValues.push(scope.customerId)
  }

  const saleWhereClause = `(${saleWhereParts.join(' OR ')})`
  const workWhereClause = `(${workWhereParts.join(' OR ')})`

  const saleRows = await selectRows<CustomerVisitLineRow>(
    `SELECT
      sales.id AS saleId,
      sales.sold_at AS soldAt,
      CASE
        WHEN TRIM(COALESCE(vehicles.plate_number, '')) <> '' THEN TRIM(vehicles.plate_number)
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
          AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
          THEN TRIM(COALESCE(vehicles.model_name, ''))
        ELSE ''
      END AS plateNumber,
      CASE
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
          AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
          THEN ''
        ELSE COALESCE(vehicles.model_name, '')
      END AS vehicleModel,
      ${effectiveSaleTotalSql('sales')} AS totalAmount,
      COALESCE(sales.card_amount, 0) AS cardAmount,
      COALESCE(sales.cash_amount, 0) AS cashAmount,
      COALESCE(sales.naver_amount, 0) AS naverAmount,
      COALESCE(sales.memo, '') AS saleMemo,
      sale_lines.id AS lineId,
      sale_lines.line_type AS lineType,
      sale_lines.item_snapshot_name AS itemSnapshotName,
      sale_lines.size_snapshot AS sizeSnapshot,
      sale_lines.quantity AS quantity,
      sale_lines.line_total AS lineTotal,
      sale_lines.memo AS lineMemo,
      items.brand_name AS brandName,
      items.pattern_name AS patternName,
      items.size_label AS sizeLabel
    FROM sales
    LEFT JOIN vehicles
      ON vehicles.id = sales.vehicle_id
    LEFT JOIN sale_lines
      ON sale_lines.sale_id = sales.id
    LEFT JOIN items
      ON items.id = sale_lines.item_id
    WHERE ${saleWhereClause}
    ORDER BY sales.sold_at DESC, sales.id DESC, sale_lines.id ASC`,
    saleBindValues,
  )
  const orphanWorkRows = await selectRows<CustomerOrphanWorkRow>(
    `SELECT
      work_logs.id AS workLogId,
      work_logs.worked_at AS soldAt,
      CASE
        WHEN TRIM(COALESCE(vehicles.plate_number, '')) <> '' THEN TRIM(vehicles.plate_number)
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
          AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
          THEN TRIM(COALESCE(vehicles.model_name, ''))
        ELSE ''
      END AS plateNumber,
      CASE
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${legacyVehiclePlateSql}) BETWEEN 7 AND 8
          AND ${legacyVehiclePlateSql} GLOB '*[0-9]*'
          THEN ''
        ELSE COALESCE(vehicles.model_name, '')
      END AS vehicleModel,
      COALESCE(work_logs.work_type, '') AS workType,
      COALESCE(work_logs.amount, 0) AS amount,
      COALESCE(work_logs.memo, '') AS memo
    FROM work_logs
    LEFT JOIN vehicles
      ON vehicles.id = work_logs.vehicle_id
    WHERE work_logs.sale_id IS NULL
      AND ${workWhereClause}
    ORDER BY work_logs.worked_at DESC, work_logs.id DESC`,
    workBindValues,
  )

  const visits = new Map<number, CustomerVisitRow & { workParts: string[] }>()
  for (const row of saleRows) {
    const saleId = Number(row.saleId)
    const visit =
      visits.get(saleId) ??
      {
        saleId,
        soldAt: row.soldAt,
        plateNumber: row.plateNumber ?? '',
        vehicleModel: row.vehicleModel ?? '',
        tireQuantity: 0,
        totalAmount: Number(row.totalAmount ?? 0),
        cardAmount: Number(row.cardAmount ?? 0),
        cashAmount: Number(row.cashAmount ?? 0),
        naverAmount: Number(row.naverAmount ?? 0),
        alignmentAmount: 0,
        serviceAmount: 0,
        workSummary: '',
        memo: row.saleMemo ?? '',
        workParts: [],
      }

    if (row.lineId) {
      const quantity = Number(row.quantity ?? 0)
      const lineTotal = Number(row.lineTotal ?? 0)
      if (row.lineType === 'tire') {
        visit.tireQuantity += quantity
      } else if (row.lineType && saleLineLooksLikeAlignment(row)) {
        visit.alignmentAmount += lineTotal
      } else if (row.lineType) {
        visit.serviceAmount += lineTotal
      }
      const workLabel = getLineWorkLabel(row)
      if (workLabel) {
        visit.workParts.push(workLabel)
      }
    }

    visits.set(saleId, visit)
  }

  const orphanVisits = orphanWorkRows.map((row): CustomerVisitRow & { workParts: string[] } => {
    const amount = Number(row.amount ?? 0)
    const isAlignment = `${row.workType} ${row.memo}`.toLowerCase().includes('alignment') || `${row.workType} ${row.memo}`.includes('얼라이')
    return {
      saleId: -Number(row.workLogId),
      soldAt: row.soldAt,
      plateNumber: row.plateNumber ?? '',
      vehicleModel: row.vehicleModel ?? '',
      tireQuantity: 0,
      totalAmount: amount,
      cardAmount: 0,
      cashAmount: amount,
      naverAmount: 0,
      alignmentAmount: isAlignment ? amount : 0,
      serviceAmount: isAlignment ? 0 : amount,
      workSummary: '',
      memo: row.memo ?? '',
      workParts: [getWorkLogLabel(row)].filter(Boolean),
    }
  })

  return [...visits.values(), ...orphanVisits]
    .map((visit) => {
      const { workParts, ...rest } = visit
      return {
        ...rest,
        workSummary: workParts.length > 0 ? workParts.join(', ') : rest.memo || '작업 내역 없음',
      }
    })
    .sort((left, right) => String(right.soldAt).localeCompare(String(left.soldAt)) || right.saleId - left.saleId)
}

function saleLineLooksLikeAlignment(row: CustomerVisitLineRow) {
  const value = `${row.itemSnapshotName ?? ''} ${row.lineMemo ?? ''}`.toLowerCase()
  return value.includes('alignment') || value.includes('얼라이')
}

export async function updateCustomerVehicleRecord(input: CustomerRecordUpdateInput): Promise<CustomerListRow> {
  const currentVehicle = await loadVehicleEditContext(input.vehicleId)
  if (!currentVehicle) {
    throw new Error('수정할 차량 정보를 찾지 못했습니다.')
  }

  const customerName = input.customerName.trim()
  const phone = input.phone.trim()
  const normalizedPhone = normalizePhone(phone)
  const plateNumber = input.plateNumber.trim()
  const normalizedPlateNumber = normalizePlate(plateNumber)
  const vehicleBrand = input.vehicleBrand.trim()
  const vehicleModel = input.vehicleModel.trim()
  const odometer = Math.max(0, Math.floor(Number(input.odometer) || 0))
  const memo = input.memo.trim()
  const resolvedPlateNumber = plateNumber || currentVehicle.plateNumber
  const resolvedNormalizedPlateNumber =
    normalizedPlateNumber || currentVehicle.normalizedPlateNumber || currentVehicle.legacyPlateKey
  const resolvedVehicleBrand = vehicleBrand || currentVehicle.brandName
  const resolvedNormalizedVehicleBrand = normalizeText(resolvedVehicleBrand)
  const resolvedVehicleModel = vehicleModel || currentVehicle.modelName
  const resolvedOdometer = odometer > 0 ? odometer : Math.max(0, Number(currentVehicle.odometer ?? 0))
  const resolvedMemo = memo || currentVehicle.memo

  let customerId = Number(input.customerId ?? 0)
  if (!Number.isInteger(customerId) || customerId <= 0) {
    customerId = 0
  }

  if (customerId <= 0 && normalizedPhone) {
    const existingCustomer = await selectFirst<{ id: number }>(
      'SELECT id FROM customers WHERE normalized_phone = ? LIMIT 1',
      [normalizedPhone],
    )
    customerId = Number(existingCustomer?.id ?? 0)
  }

  if (customerId > 0) {
    await execute(
      `UPDATE customers
      SET
        name = ?,
        phone = ?,
        normalized_phone = ?,
        memo = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [customerName, phone, normalizedPhone, memo, customerId],
    )
  } else if (customerName || normalizedPhone) {
    const insertResult = await execute(
      `INSERT INTO customers (
        name,
        phone,
        normalized_phone,
        memo,
        updated_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [customerName, phone, normalizedPhone, memo],
    )
    customerId = Number(insertResult.lastInsertId)
  }

  const resolvedCustomerId =
    customerId > 0
      ? customerId
      : Number.isInteger(currentVehicle.customerId) && Number(currentVehicle.customerId) > 0
        ? Number(currentVehicle.customerId)
        : null
  const linkedVehicleIds = await loadLinkedVehicleIds(resolvedNormalizedPlateNumber, input.vehicleId)
  const vehiclePlaceholderSql = linkedVehicleIds.map(() => '?').join(', ')
  await execute(
    `UPDATE vehicles
    SET
      customer_id = ?,
      plate_number = ?,
      normalized_plate_number = ?,
      brand_name = ?,
      normalized_brand = ?,
      model_name = ?,
      odometer = ?,
      memo = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id IN (${vehiclePlaceholderSql})`,
    [
      resolvedCustomerId,
      resolvedPlateNumber,
      resolvedNormalizedPlateNumber,
      resolvedVehicleBrand,
      resolvedNormalizedVehicleBrand,
      resolvedVehicleModel,
      resolvedOdometer,
      resolvedMemo,
      ...linkedVehicleIds,
    ],
  )

  const updatedRow = await loadCustomerVehicleRecord(input.vehicleId)
  if (!updatedRow) {
    throw new Error('저장한 고객 / 차량 정보를 다시 불러오지 못했습니다.')
  }

  return updatedRow
}

export async function getCustomerFilterOptions(): Promise<CustomerFilterOptions> {
  return {
    vehicleBrands: [],
    vehicleModels: [],
    purchasedBrands: [],
  }
}
