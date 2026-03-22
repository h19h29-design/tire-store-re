import { execute, selectFirst, selectRows } from '../../lib/db'
import { normalizePhone, normalizePlate, normalizeText } from '../../lib/normalize'
import type {
  CustomerFilterOptions,
  CustomerListRow,
  CustomerRecordUpdateInput,
  CustomerSearchFilters,
} from '../../lib/types'

const defaultFilters: CustomerSearchFilters = {
  query: '',
  vehicleBrand: '',
  vehicleModel: '',
  purchasedBrand: '',
  saleStatus: 'all',
}

const legacyVehiclePlateSql = "REPLACE(REPLACE(TRIM(COALESCE(vehicles.model_name, '')), ' ', ''), '-', '')"

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

export async function searchCustomers(filters: Partial<CustomerSearchFilters> = {}) {
  const mergedFilters = { ...defaultFilters, ...filters }
  const rawQuery = mergedFilters.query.trim()
  const normalizedTextQuery = normalizeText(rawQuery)
  const normalizedPhoneQuery = normalizePhone(rawQuery)
  const normalizedPlateQuery = normalizePlate(rawQuery)
  const queryClauses: string[] = []
  const queryBindValues: string[] = []

  if (normalizedPlateQuery.length >= 2) {
    queryClauses.push(`(vehicles.normalized_plate_number LIKE ? OR ${legacyVehiclePlateSql} LIKE ?)`)
    queryBindValues.push(`%${normalizedPlateQuery}%`, `%${normalizedPlateQuery}%`)
  }

  if (normalizedPhoneQuery.length >= 4) {
    queryClauses.push('customers.normalized_phone LIKE ?')
    queryBindValues.push(`%${normalizedPhoneQuery}%`)
  }

  if (normalizedTextQuery.length >= 2) {
    queryClauses.push(
      "(LOWER(customers.name) LIKE '%' || LOWER(?) || '%' OR LOWER(vehicles.model_name) LIKE '%' || LOWER(?) || '%' OR LOWER(vehicles.brand_name) LIKE '%' || LOWER(?) || '%')",
    )
    queryBindValues.push(rawQuery, rawQuery, rawQuery)
  }

  const whereClause = queryClauses.length > 0 ? `(${queryClauses.join(' OR ')})` : '1 = 1'

  return selectRows<CustomerListRow>(
    `WITH sale_totals AS (
      SELECT
        sales.vehicle_id AS vehicleId,
        COUNT(*) AS visitCount,
        COALESCE(SUM(sales.total_amount), 0) AS totalSaleAmount,
        COALESCE(SUM(sales.card_amount), 0) AS cardAmount,
        COALESCE(SUM(COALESCE(sales.naver_amount, 0)), 0) AS naverAmount,
        COALESCE(SUM(sales.cash_amount), 0) AS cashAmount,
        MAX(sales.sold_at) AS latestSaleAt
      FROM sales
      WHERE sales.vehicle_id IS NOT NULL
      GROUP BY sales.vehicle_id
    ),
    sale_quantities AS (
      SELECT
        sales.vehicle_id AS vehicleId,
        COALESCE(SUM(CASE WHEN sale_lines.line_type = 'tire' THEN sale_lines.quantity ELSE 0 END), 0) AS saleQuantity
      FROM sales
      INNER JOIN sale_lines
        ON sale_lines.sale_id = sales.id
      WHERE sales.vehicle_id IS NOT NULL
      GROUP BY sales.vehicle_id
    ),
    alignment_totals AS (
      SELECT
        work_logs.vehicle_id AS vehicleId,
        COALESCE(SUM(work_logs.amount), 0) AS alignmentAmount
      FROM work_logs
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
        vehicles.id AS vehicleId,
        sales.id AS saleId,
        sales.memo AS saleMemo
      FROM vehicles
      LEFT JOIN sales
        ON sales.id = (
          SELECT sales_latest.id
          FROM sales sales_latest
          WHERE sales_latest.vehicle_id = vehicles.id
          ORDER BY sales_latest.sold_at DESC, sales_latest.id DESC
          LIMIT 1
        )
    ),
    latest_sale_lines AS (
      SELECT
        latest_sales.vehicleId AS vehicleId,
        COALESCE(
          GROUP_CONCAT(${latestSaleLineSummaryExpression}, ', '),
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
      COALESCE(sale_quantities.saleQuantity, 0) AS saleQuantity,
      COALESCE(sale_totals.visitCount, 0) AS visitCount,
      COALESCE(sale_totals.totalSaleAmount, 0) AS totalSaleAmount,
      COALESCE(sale_totals.cardAmount, 0) AS cardAmount,
      COALESCE(sale_totals.naverAmount, 0) AS naverAmount,
      COALESCE(sale_totals.cashAmount, 0) AS cashAmount,
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
    FROM vehicles
    LEFT JOIN customers
      ON customers.id = vehicles.customer_id
    LEFT JOIN sale_totals
      ON sale_totals.vehicleId = vehicles.id
    LEFT JOIN sale_quantities
      ON sale_quantities.vehicleId = vehicles.id
    LEFT JOIN alignment_totals
      ON alignment_totals.vehicleId = vehicles.id
    LEFT JOIN latest_sales
      ON latest_sales.vehicleId = vehicles.id
    LEFT JOIN latest_sale_lines
      ON latest_sale_lines.vehicleId = vehicles.id
    WHERE ${whereClause}
    ORDER BY
      CASE WHEN COALESCE(sale_totals.latestSaleAt, '') = '' THEN 1 ELSE 0 END,
      COALESCE(sale_totals.latestSaleAt, '') DESC,
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
    LIMIT 300`,
    queryBindValues,
  )
}

export async function updateCustomerVehicleRecord(input: CustomerRecordUpdateInput) {
  const customerName = input.customerName.trim()
  const phone = input.phone.trim()
  const normalizedPhone = normalizePhone(phone)
  const plateNumber = input.plateNumber.trim()
  const normalizedPlateNumber = normalizePlate(plateNumber)
  const vehicleBrand = input.vehicleBrand.trim()
  const normalizedVehicleBrand = normalizeText(vehicleBrand)
  const vehicleModel = input.vehicleModel.trim()
  const odometer = Math.max(0, Math.floor(Number(input.odometer) || 0))
  const memo = input.memo.trim()

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
    WHERE id = ?`,
    [
      customerId > 0 ? customerId : null,
      plateNumber,
      normalizedPlateNumber,
      vehicleBrand,
      normalizedVehicleBrand,
      vehicleModel,
      odometer,
      memo,
      input.vehicleId,
    ],
  )
}

export async function getCustomerFilterOptions(): Promise<CustomerFilterOptions> {
  return {
    vehicleBrands: [],
    vehicleModels: [],
    purchasedBrands: [],
  }
}
