import { execute, selectFirst, selectRows, runTransaction } from '../../lib/db'
import { getCurrentSeoulDateTimeValue, normalizePhone, normalizePlate, normalizeText } from '../../lib/normalize'
import { guessVehicleBrandName } from '../../lib/referenceData'
import type { InventoryListRow, PlateLookupRow } from '../../lib/types'
import { ensureSaleLineCostSnapshotSchema } from './saleLineCostSnapshotSchema'

export type SaleDraftLine = InventoryListRow & {
  quantity: number
  unitPrice: number
  lineTotalOverride?: number | null
  maxEditableQuantity?: number
  persistedItemId?: number | null
  inventoryLinked?: boolean
}

export type SaveSaleInput = {
  customerName: string
  phone: string
  plateNumber: string
  vehicleModel: string
  odometer: number
  memo: string
  cardAmount: number
  naverAmount: number
  cashAmount: number
  alignmentAmount: number
  serviceDescription: string
  serviceAmount: number
  lines: SaleDraftLine[]
}

export type SaleEditDraft = {
  saleId: number
  soldAt: string
  customerName: string
  phone: string
  plateNumber: string
  vehicleModel: string
  odometer: number
  memo: string
  cardAmount: number
  naverAmount: number
  cashAmount: number
  alignmentAmount: number
  serviceDescription: string
  serviceAmount: number
  lines: SaleDraftLine[]
}

type IdRow = {
  id: number
}

type BalanceRow = {
  quantityAvailable: number
}

type ItemCostRow = {
  id: number
  defaultCostPrice: number
}

type TableInfoRow = {
  name: string
}

type SaleHeaderRow = {
  saleId: number
  saleNumber: string
  soldAt: string
  customerName: string
  phone: string
  plateNumber: string
  vehicleModel: string
  odometer: number
  memo: string
  cardAmount: number
  naverAmount: number
  cashAmount: number
}

type SaleLineDetailRow = {
  lineType: string
  itemId: number | null
  itemSnapshotName: string
  sizeSnapshot: string
  quantity: number
  unitPrice: number
  lineTotal: number
  skuCode: string | null
  brandName: string | null
  patternName: string | null
  sizeLabel: string | null
  productName: string | null
  defaultCostPrice: number | null
  defaultSalePrice: number | null
  defaultDiscountRate: number | null
  quantityOnHand: number | null
  quantityAvailable: number | null
  publicQuoteEnabled: number | null
  publicQuoteUrl: string | null
}

type SaleQuantityRow = {
  itemId: number
  quantity: number
}

let salesSchemaPromise: Promise<void> | null = null
const normalizedLegacyPlateSql = "REPLACE(REPLACE(TRIM(COALESCE(model_name, '')), ' ', ''), '-', '')"

async function loadLinkedVehicleIdsByPlate(normalizedPlate: string, fallbackVehicleId: number) {
  if (!normalizedPlate) {
    return [fallbackVehicleId]
  }

  const rows = await selectRows<IdRow>(
    `SELECT id
    FROM vehicles
    WHERE normalized_plate_number = ?
      OR (
        COALESCE(normalized_plate_number, '') = ''
        AND LENGTH(${normalizedLegacyPlateSql}) BETWEEN 7 AND 8
        AND ${normalizedLegacyPlateSql} GLOB '*[0-9]*'
        AND ${normalizedLegacyPlateSql} = ?
      )
    ORDER BY id ASC`,
    [normalizedPlate, normalizedPlate],
  )

  const uniqueIds = [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0))]
  return uniqueIds.length > 0 ? uniqueIds : [fallbackVehicleId]
}

function toSafeWholeNumber(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function normalizeServiceDescription(value: string) {
  const trimmed = value.trim()
  return /^-+$/.test(trimmed) ? '' : trimmed
}

function getPersistedItemId(line: SaleDraftLine) {
  const candidate = Number(line.persistedItemId ?? line.id)
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null
}

function isInventoryLinkedLine(line: SaleDraftLine) {
  return line.inventoryLinked !== false && getPersistedItemId(line) !== null
}

function splitSnapshotName(snapshotName: string) {
  const trimmed = snapshotName.trim()
  if (!trimmed) {
    return {
      brandName: '연결 끊긴 품목',
      patternName: '',
    }
  }

  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) {
    return {
      brandName: '연결 끊긴 품목',
      patternName: trimmed,
    }
  }

  return {
    brandName: parts.shift() ?? '연결 끊긴 품목',
    patternName: parts.join(' '),
  }
}

function isAlignmentDescription(value: string) {
  const normalized = normalizeText(value)
  return normalized.includes('alignment') || normalized.includes(normalizeText('얼라이'))
}

async function ensureSalesSchema() {
  salesSchemaPromise ??= (async () => {
    const saleColumns = await selectRows<TableInfoRow>('PRAGMA table_info(sales)')
    const hasNaverAmount = saleColumns.some((row) => row.name === 'naver_amount')
    const hasCardFeeRate = saleColumns.some((row) => row.name === 'card_fee_rate_basis_points')
    const hasIsNaverCard = saleColumns.some((row) => row.name === 'is_naver_card')

    if (!hasNaverAmount) {
      await execute('ALTER TABLE sales ADD COLUMN naver_amount INTEGER NOT NULL DEFAULT 0')
    }

    if (!hasCardFeeRate) {
      await execute('ALTER TABLE sales ADD COLUMN card_fee_rate_basis_points INTEGER NOT NULL DEFAULT 300')
    }

    if (!hasIsNaverCard) {
      await execute('ALTER TABLE sales ADD COLUMN is_naver_card INTEGER NOT NULL DEFAULT 0')
    }

    await execute(
      `UPDATE sales
      SET
        naver_amount = CASE
          WHEN COALESCE(naver_amount, 0) = 0 AND COALESCE(is_naver_card, 0) = 1 THEN COALESCE(card_amount, 0)
          ELSE COALESCE(naver_amount, 0)
        END,
        card_amount = CASE
          WHEN COALESCE(naver_amount, 0) = 0 AND COALESCE(is_naver_card, 0) = 1 THEN 0
          ELSE COALESCE(card_amount, 0)
        END
      WHERE COALESCE(is_naver_card, 0) = 1
        AND COALESCE(card_amount, 0) > 0
        AND COALESCE(naver_amount, 0) = 0`,
    )
  })()

  return salesSchemaPromise
}

async function insertSaleContents(input: {
  saleId: number
  saleNumber: string
  soldAt: string
  customerId: number | null
  vehicleId: number | null
  memo: string
  alignmentAmount: number
  serviceDescription: string
  serviceAmount: number
  lines: SaleDraftLine[]
  costPriceSnapshots: Map<number, number>
  applyInventoryEffect?: boolean
}) {
  const normalizedServiceDescription = normalizeServiceDescription(input.serviceDescription)
  const applyInventoryEffect = input.applyInventoryEffect !== false

  for (const line of input.lines) {
    const lineTotal = line.lineTotalOverride ?? line.unitPrice * line.quantity
    const unitPrice =
      line.quantity > 0 ? Math.max(0, Math.round(lineTotal / line.quantity)) : Math.max(0, line.unitPrice)
    const persistedItemId = getPersistedItemId(line)
    const costPriceSnapshot = persistedItemId ? input.costPriceSnapshots.get(persistedItemId) ?? null : null

    await execute(
      `INSERT INTO sale_lines (
        sale_id,
        line_type,
        item_id,
        item_snapshot_name,
        size_snapshot,
        cost_price_snapshot,
        quantity,
        unit_price,
        line_total,
        memo
      ) VALUES (?, 'tire', ?, ?, ?, ?, ?, ?, ?, '')`,
      [
        input.saleId,
        persistedItemId,
        `${line.brandName} ${line.patternName}`.trim(),
        line.sizeLabel,
        costPriceSnapshot,
        line.quantity,
        unitPrice,
        lineTotal,
      ],
    )

    if (applyInventoryEffect && persistedItemId) {
      await execute(
        `INSERT INTO inventory_movements (
          item_id,
          movement_type,
          quantity,
          unit_cost,
          unit_price,
          occurred_at,
          reference_type,
          reference_id,
          memo
        ) VALUES (?, 'sale', ?, 0, ?, ?, 'sale', ?, ?)`,
        [
          persistedItemId,
          -line.quantity,
          unitPrice,
          input.soldAt,
          input.saleId,
          input.saleNumber,
        ],
      )

      await execute(
        `UPDATE inventory_balance_cache
        SET
          quantity_on_hand = quantity_on_hand - ?,
          quantity_available = quantity_available - ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE item_id = ?`,
        [line.quantity, line.quantity, persistedItemId],
      )
    }
  }

  if (input.alignmentAmount > 0) {
    await insertServiceEntry({
      saleId: input.saleId,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      description: '얼라이먼트',
      amount: input.alignmentAmount,
      memo: input.memo,
      soldAt: input.soldAt,
    })
  }

  if (input.serviceAmount > 0 || normalizedServiceDescription) {
    const description = normalizedServiceDescription || '추가 작업'
    await insertServiceEntry({
      saleId: input.saleId,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      description,
      amount: input.serviceAmount,
      memo: input.memo,
      soldAt: input.soldAt,
    })
  }
}

async function loadExistingSaleQuantities(saleId: number) {
  const rows = await selectRows<SaleQuantityRow>(
    `SELECT
      item_id AS itemId,
      COALESCE(SUM(quantity), 0) AS quantity
    FROM sale_lines
    WHERE sale_id = ?
      AND line_type = 'tire'
      AND item_id IS NOT NULL
    GROUP BY item_id`,
    [saleId],
  )

  return new Map(rows.map((row) => [Number(row.itemId), Math.max(0, Number(row.quantity ?? 0))]))
}

async function restoreInventoryForSale(saleId: number) {
  const rows = await selectRows<SaleQuantityRow>(
    `SELECT
      item_id AS itemId,
      quantity AS quantity
    FROM sale_lines
    WHERE sale_id = ?
      AND line_type = 'tire'
      AND item_id IS NOT NULL`,
    [saleId],
  )

  for (const row of rows) {
    const itemId = Number(row.itemId)
    const quantity = Math.max(0, Number(row.quantity ?? 0))
    if (itemId <= 0 || quantity <= 0) {
      continue
    }

    await execute(
      `INSERT INTO inventory_balance_cache (
        item_id,
        quantity_on_hand,
        quantity_reserved,
        quantity_available,
        updated_at
      ) VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(item_id) DO UPDATE SET
        quantity_on_hand = quantity_on_hand + excluded.quantity_on_hand,
        quantity_available = quantity_available + excluded.quantity_available,
        updated_at = CURRENT_TIMESTAMP`,
      [itemId, quantity, quantity],
    )
  }
}

async function hasSaleInventoryEffect(saleId: number) {
  const movementRow = await selectFirst<{ movementCount: number }>(
    `SELECT COUNT(*) AS movementCount
    FROM inventory_movements
    WHERE reference_type = 'sale'
      AND reference_id = ?`,
    [saleId],
  )

  return Number(movementRow?.movementCount ?? 0) > 0
}

async function clearSaleDetailRecords(saleId: number) {
  await execute(
    `DELETE FROM inventory_movements
    WHERE reference_type = 'sale'
      AND reference_id = ?`,
    [saleId],
  )
  await execute('DELETE FROM work_logs WHERE sale_id = ?', [saleId])
  await execute('DELETE FROM sale_lines WHERE sale_id = ?', [saleId])
}

export async function saveSale(input: SaveSaleInput) {
  await ensureSalesSchema()
  await ensureSaleLineCostSnapshotSchema()

  const totalAmount =
    input.lines.reduce((sum, line) => sum + (line.lineTotalOverride ?? line.unitPrice * line.quantity), 0) +
    input.alignmentAmount +
    input.serviceAmount
  const odometer = toSafeWholeNumber(input.odometer)

  if (totalAmount <= 0) {
    throw new Error('판매 항목이나 작업비가 없습니다.')
  }

  await validateLineQuantities(input.lines)

  return runTransaction(async () => {
    const costPriceSnapshots = await loadCostPriceSnapshots(input.lines)
    const customerId = await ensureCustomer(input.customerName, input.phone)
    const vehicleId = await ensureVehicle(customerId, input.plateNumber, input.vehicleModel, odometer)
    const soldAt = getCurrentSeoulDateTimeValue()
    const saleNumber = `SAL-${Date.now()}`
    const cardAmount = input.cardAmount
    const naverAmount = input.naverAmount
    const cashAmount = input.cashAmount
    const cardFeeRateBasisPoints =
      naverAmount > 0 && cardAmount === 0 ? 500 : cardAmount > 0 ? 300 : 0
    const isNaverCard = naverAmount > 0

    const saleInsert = await execute(
      `INSERT INTO sales (
        sale_number,
        sold_at,
        customer_id,
        vehicle_id,
        total_amount,
        card_amount,
        naver_amount,
        cash_amount,
        card_fee_rate_basis_points,
        is_naver_card,
        memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        saleNumber,
        soldAt,
        customerId,
        vehicleId,
        totalAmount,
        cardAmount,
        naverAmount,
        cashAmount,
        cardFeeRateBasisPoints,
        isNaverCard ? 1 : 0,
        input.memo,
      ],
    )

    const saleId = Number(saleInsert.lastInsertId)
    await insertSaleContents({
      saleId,
      saleNumber,
      soldAt,
      customerId,
      vehicleId,
      memo: input.memo,
      alignmentAmount: input.alignmentAmount,
      serviceDescription: input.serviceDescription,
      serviceAmount: input.serviceAmount,
      lines: input.lines,
      costPriceSnapshots,
    })

    return { saleId, saleNumber, totalAmount }
  })
}

export async function loadSaleForEdit(saleId: number): Promise<SaleEditDraft> {
  await ensureSalesSchema()
  await ensureSaleLineCostSnapshotSchema()

  const sale = await selectFirst<SaleHeaderRow>(
    `SELECT
      sales.id AS saleId,
      sales.sale_number AS saleNumber,
      sales.sold_at AS soldAt,
      COALESCE(customers.name, '') AS customerName,
      COALESCE(customers.phone, '') AS phone,
      CASE
        WHEN TRIM(COALESCE(vehicles.plate_number, '')) <> '' THEN TRIM(vehicles.plate_number)
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${normalizedLegacyPlateSql}) BETWEEN 7 AND 8
          AND ${normalizedLegacyPlateSql} GLOB '*[0-9]*'
          THEN TRIM(COALESCE(vehicles.model_name, ''))
        ELSE ''
      END AS plateNumber,
      CASE
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${normalizedLegacyPlateSql}) BETWEEN 7 AND 8
          AND ${normalizedLegacyPlateSql} GLOB '*[0-9]*'
          THEN ''
        ELSE COALESCE(vehicles.model_name, '')
      END AS vehicleModel,
      COALESCE(vehicles.odometer, 0) AS odometer,
      COALESCE(sales.memo, '') AS memo,
      COALESCE(sales.card_amount, 0) AS cardAmount,
      COALESCE(sales.naver_amount, 0) AS naverAmount,
      COALESCE(sales.cash_amount, 0) AS cashAmount
    FROM sales
    LEFT JOIN customers
      ON customers.id = sales.customer_id
    LEFT JOIN vehicles
      ON vehicles.id = sales.vehicle_id
    WHERE sales.id = ?
    LIMIT 1`,
    [saleId],
  )

  if (!sale) {
    throw new Error('수정할 판매 내역을 찾지 못했습니다.')
  }

  const lineRows = await selectRows<SaleLineDetailRow>(
    `SELECT
      sale_lines.line_type AS lineType,
      sale_lines.item_id AS itemId,
      sale_lines.item_snapshot_name AS itemSnapshotName,
      sale_lines.size_snapshot AS sizeSnapshot,
      sale_lines.quantity AS quantity,
      sale_lines.unit_price AS unitPrice,
      sale_lines.line_total AS lineTotal,
      items.sku_code AS skuCode,
      items.brand_name AS brandName,
      items.pattern_name AS patternName,
      items.size_label AS sizeLabel,
      items.product_name AS productName,
      items.default_cost_price AS defaultCostPrice,
      items.default_sale_price AS defaultSalePrice,
      COALESCE(items.default_discount_rate, 0) AS defaultDiscountRate,
      COALESCE(inventory_balance_cache.quantity_on_hand, 0) AS quantityOnHand,
      COALESCE(inventory_balance_cache.quantity_available, 0) AS quantityAvailable,
      COALESCE(items.public_quote_enabled, 0) AS publicQuoteEnabled,
      COALESCE(items.public_quote_url, '') AS publicQuoteUrl
    FROM sale_lines
    LEFT JOIN items
      ON items.id = sale_lines.item_id
    LEFT JOIN inventory_balance_cache
      ON inventory_balance_cache.item_id = sale_lines.item_id
    WHERE sale_lines.sale_id = ?
    ORDER BY sale_lines.id ASC`,
    [saleId],
  )

  const saleAdjustsInventory = await hasSaleInventoryEffect(saleId)
  const lines: SaleDraftLine[] = []
  let alignmentAmount = 0
  let serviceAmount = 0
  const serviceDescriptions: string[] = []

  for (const row of lineRows) {
    if (row.lineType === 'tire') {
      const itemId = Number(row.itemId ?? 0)
      const quantity = Math.max(0, Number(row.quantity ?? 0))
      const currentQuantityAvailable = Math.max(0, Number(row.quantityAvailable ?? 0))
      const currentQuantityOnHand = Math.max(0, Number(row.quantityOnHand ?? row.quantityAvailable ?? 0))
      const isLinkedInventoryItem = itemId > 0 && Boolean(row.brandName) && Boolean(row.patternName)
      const snapshotIdentity = splitSnapshotName(row.itemSnapshotName)
      const maxEditableQuantity = isLinkedInventoryItem
        ? saleAdjustsInventory
          ? currentQuantityAvailable + quantity
          : Math.max(currentQuantityAvailable, quantity)
        : Math.max(quantity, 999)
      const quantityOnHand = isLinkedInventoryItem
        ? saleAdjustsInventory
          ? currentQuantityOnHand + quantity
          : Math.max(currentQuantityOnHand, quantity)
        : quantity
      lines.push({
        id: isLinkedInventoryItem ? itemId : -(lines.length + 1),
        persistedItemId: isLinkedInventoryItem ? itemId : null,
        inventoryLinked: isLinkedInventoryItem,
        skuCode: row.skuCode ?? (isLinkedInventoryItem ? String(itemId) : `archived-${saleId}-${lines.length + 1}`),
        brandName: row.brandName ?? snapshotIdentity.brandName,
        patternName: row.patternName ?? snapshotIdentity.patternName,
        sizeLabel: row.sizeLabel || row.sizeSnapshot || '',
        productName: row.productName ?? (isLinkedInventoryItem ? '' : '연결이 끊긴 기존 판매 품목'),
        defaultCostPrice: Math.max(0, Number(row.defaultCostPrice ?? 0)),
        defaultSalePrice: Math.max(0, Number(row.unitPrice ?? row.defaultSalePrice ?? 0)),
        defaultDiscountRate: Math.max(0, Number(row.defaultDiscountRate ?? 0)),
        quantityOnHand,
        quantityAvailable: isLinkedInventoryItem ? currentQuantityAvailable : quantity,
        latestReceivedAt: null,
        publicQuoteEnabled: Boolean(Number(row.publicQuoteEnabled ?? 0)),
        publicQuoteUrl: row.publicQuoteUrl ?? '',
        quantity,
        unitPrice: Math.max(0, Number(row.unitPrice ?? 0)),
        lineTotalOverride: Math.max(0, Number(row.lineTotal ?? 0)),
        maxEditableQuantity,
      })
      continue
    }

    const amount = Math.max(0, Number(row.lineTotal ?? 0))
    if (isAlignmentDescription(row.itemSnapshotName)) {
      alignmentAmount += amount
      continue
    }

    serviceAmount += amount
    if (row.itemSnapshotName.trim()) {
      serviceDescriptions.push(row.itemSnapshotName.trim())
    }
  }

  return {
    saleId: Number(sale.saleId),
    soldAt: sale.soldAt,
    customerName: sale.customerName,
    phone: sale.phone,
    plateNumber: sale.plateNumber,
    vehicleModel: sale.vehicleModel,
    odometer: Math.max(0, Number(sale.odometer ?? 0)),
    memo: sale.memo,
    cardAmount: Math.max(0, Number(sale.cardAmount ?? 0)),
    naverAmount: Math.max(0, Number(sale.naverAmount ?? 0)),
    cashAmount: Math.max(0, Number(sale.cashAmount ?? 0)),
    alignmentAmount,
    serviceDescription: Array.from(new Set(serviceDescriptions)).join(', '),
    serviceAmount,
    lines,
  }
}

export async function updateSale(saleId: number, input: SaveSaleInput) {
  await ensureSalesSchema()
  await ensureSaleLineCostSnapshotSchema()

  const totalAmount =
    input.lines.reduce((sum, line) => sum + (line.lineTotalOverride ?? line.unitPrice * line.quantity), 0) +
    input.alignmentAmount +
    input.serviceAmount
  const odometer = toSafeWholeNumber(input.odometer)

  if (totalAmount <= 0) {
    throw new Error('판매 항목이나 작업비가 없습니다.')
  }

  const existingSale = await selectFirst<Pick<SaleHeaderRow, 'saleNumber' | 'soldAt'>>(
    `SELECT
      sale_number AS saleNumber,
      sold_at AS soldAt
    FROM sales
    WHERE id = ?
    LIMIT 1`,
    [saleId],
  )

  if (!existingSale) {
    throw new Error('수정할 판매 내역을 찾지 못했습니다.')
  }

  const saleAdjustsInventory = await hasSaleInventoryEffect(saleId)
  if (saleAdjustsInventory) {
    const existingQuantities = await loadExistingSaleQuantities(saleId)
    await validateLineQuantities(input.lines, existingQuantities)
  }

  const costPriceSnapshots = await loadCostPriceSnapshots(input.lines)
  const customerId = await ensureCustomer(input.customerName, input.phone)
  const vehicleId = await ensureVehicle(customerId, input.plateNumber, input.vehicleModel, odometer)
  const cardAmount = input.cardAmount
  const naverAmount = input.naverAmount
  const cashAmount = input.cashAmount
  const cardFeeRateBasisPoints =
    naverAmount > 0 && cardAmount === 0 ? 500 : cardAmount > 0 ? 300 : 0
  const isNaverCard = naverAmount > 0

  if (saleAdjustsInventory) {
    await restoreInventoryForSale(saleId)
  }
  await clearSaleDetailRecords(saleId)
  await execute(
    `UPDATE sales
    SET
      customer_id = ?,
      vehicle_id = ?,
      total_amount = ?,
      card_amount = ?,
      naver_amount = ?,
      cash_amount = ?,
      card_fee_rate_basis_points = ?,
      is_naver_card = ?,
      memo = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [
      customerId,
      vehicleId,
      totalAmount,
      cardAmount,
      naverAmount,
      cashAmount,
      cardFeeRateBasisPoints,
      isNaverCard ? 1 : 0,
      input.memo,
      saleId,
    ],
  )

  await insertSaleContents({
    saleId,
    saleNumber: existingSale.saleNumber,
    soldAt: existingSale.soldAt,
    customerId,
    vehicleId,
    memo: input.memo,
    alignmentAmount: input.alignmentAmount,
    serviceDescription: input.serviceDescription,
    serviceAmount: input.serviceAmount,
    lines: input.lines,
    costPriceSnapshots,
    applyInventoryEffect: saleAdjustsInventory,
  })

  return {
    saleId,
    saleNumber: existingSale.saleNumber,
    totalAmount,
  }
}

export async function deleteSale(saleId: number) {
  await ensureSalesSchema()
  await ensureSaleLineCostSnapshotSchema()

  const existingSale = await selectFirst<Pick<SaleHeaderRow, 'saleNumber'>>(
    `SELECT sale_number AS saleNumber
    FROM sales
    WHERE id = ?
    LIMIT 1`,
    [saleId],
  )

  if (!existingSale) {
    throw new Error('삭제할 판매 내역을 찾지 못했습니다.')
  }

  if (await hasSaleInventoryEffect(saleId)) {
    await restoreInventoryForSale(saleId)
  }
  await clearSaleDetailRecords(saleId)
  await execute('DELETE FROM sales WHERE id = ?', [saleId])

  return existingSale.saleNumber
}

async function loadCostPriceSnapshots(lines: SaleDraftLine[]) {
  const itemIds = Array.from(
    new Set(
      lines
        .map((line) => getPersistedItemId(line))
        .filter((itemId): itemId is number => typeof itemId === 'number' && itemId > 0),
    ),
  )
  if (itemIds.length === 0) {
    return new Map<number, number>()
  }

  const placeholders = itemIds.map(() => '?').join(', ')
  const rows = await selectRows<ItemCostRow>(
    `SELECT
      id AS id,
      default_cost_price AS defaultCostPrice
    FROM items
    WHERE id IN (${placeholders})`,
    itemIds,
  )

  return new Map(
    rows.map((row) => [Number(row.id), Math.max(0, Number(row.defaultCostPrice ?? 0))]),
  )
}

async function insertServiceEntry(input: {
  saleId: number
  customerId: number | null
  vehicleId: number | null
  description: string
  amount: number
  memo: string
  soldAt: string
}) {
  await execute(
    `INSERT INTO sale_lines (
      sale_id,
      line_type,
      item_id,
      item_snapshot_name,
      size_snapshot,
      cost_price_snapshot,
      quantity,
      unit_price,
      line_total,
      memo
    ) VALUES (?, 'service', NULL, ?, '', NULL, 1, ?, ?, ?)`,
    [input.saleId, input.description, input.amount, input.amount, input.memo],
  )

  await execute(
    `INSERT INTO work_logs (
      sale_id,
      customer_id,
      vehicle_id,
      work_type,
      amount,
      memo,
      worked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.saleId,
      input.customerId,
      input.vehicleId,
      input.description,
      input.amount,
      input.memo,
      input.soldAt,
    ],
  )
}

async function validateLineQuantities(lines: SaleDraftLine[], availableAdjustments = new Map<number, number>()) {
  for (const line of lines) {
    const persistedItemId = getPersistedItemId(line)
    if (line.quantity <= 0) {
      throw new Error('수량은 1개 이상이어야 합니다.')
    }
    if (!persistedItemId || !isInventoryLinkedLine(line)) {
      continue
    }

    const balanceRow = await selectFirst<BalanceRow>(
      `SELECT quantity_available AS quantityAvailable
      FROM inventory_balance_cache
      WHERE item_id = ?`,
      [persistedItemId],
    )

    const available =
      Number(balanceRow?.quantityAvailable ?? 0) + Number(availableAdjustments.get(persistedItemId) ?? 0)
    if (line.quantity > available) {
      throw new Error(`${line.sizeLabel} / ${line.patternName} 재고가 부족합니다.`)
    }
  }
}

async function ensureCustomer(name: string, phone: string) {
  const normalizedPhone = normalizePhone(phone)
  if (normalizedPhone) {
    const existingCustomer = await selectFirst<IdRow>(
      'SELECT id FROM customers WHERE normalized_phone = ? LIMIT 1',
      [normalizedPhone],
    )
    if (existingCustomer) {
      await execute(
        'UPDATE customers SET name = CASE WHEN ? <> \'\' THEN ? ELSE name END, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [name, name, existingCustomer.id],
      )
      return Number(existingCustomer.id)
    }
  }

  if (!name.trim() && !normalizedPhone) {
    return null
  }

  const insertResult = await execute(
    `INSERT INTO customers (
      name,
      phone,
      normalized_phone,
      memo
    ) VALUES (?, ?, ?, '')`,
    [name.trim(), phone.trim(), normalizedPhone],
  )

  return Number(insertResult.lastInsertId)
}

async function ensureVehicle(
  customerId: number | null,
  plateNumber: string,
  vehicleModel: string,
  odometer: number,
) {
  const normalizedPlate = normalizePlate(plateNumber)
  const guessedBrand = guessVehicleBrandName(vehicleModel)
  if (normalizedPlate) {
    const existingVehicle = await selectFirst<IdRow>(
      `SELECT id
      FROM vehicles
      WHERE normalized_plate_number = ?
        OR ${normalizedLegacyPlateSql} = ?
      LIMIT 1`,
      [normalizedPlate, normalizedPlate],
    )
    if (existingVehicle) {
      const linkedVehicleIds = await loadLinkedVehicleIdsByPlate(normalizedPlate, Number(existingVehicle.id))
      const vehiclePlaceholderSql = linkedVehicleIds.map(() => '?').join(', ')
      await execute(
        `UPDATE vehicles
        SET
          customer_id = COALESCE(?, customer_id),
          plate_number = CASE WHEN ? <> '' THEN ? ELSE plate_number END,
          normalized_plate_number = CASE WHEN ? <> '' THEN ? ELSE normalized_plate_number END,
          brand_name = CASE WHEN ? <> '' THEN ? ELSE brand_name END,
          normalized_brand = CASE WHEN ? <> '' THEN ? ELSE normalized_brand END,
          model_name = CASE WHEN ? <> '' THEN ? ELSE model_name END,
          odometer = CASE WHEN ? > 0 THEN ? ELSE odometer END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${vehiclePlaceholderSql})`,
        [
          customerId,
          plateNumber.trim(),
          plateNumber.trim(),
          normalizedPlate,
          normalizedPlate,
          guessedBrand,
          guessedBrand,
          guessedBrand,
          normalizeText(guessedBrand),
          vehicleModel,
          vehicleModel,
          odometer,
          odometer,
          ...linkedVehicleIds,
        ],
      )
      return Number(existingVehicle.id)
    }
  }

  if (!plateNumber.trim() && !vehicleModel.trim()) {
    return null
  }

  const insertResult = await execute(
    `INSERT INTO vehicles (
      customer_id,
      plate_number,
      normalized_plate_number,
      brand_name,
      normalized_brand,
      model_name,
      odometer,
      memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '')`,
    [
      customerId,
      plateNumber.trim(),
      normalizedPlate,
      guessedBrand,
      normalizeText(guessedBrand),
      vehicleModel.trim(),
      odometer,
    ],
  )

  return Number(insertResult.lastInsertId)
}

export async function lookupSaleCustomers(input: {
  customerName: string
  phone: string
  plateNumber: string
}) {
  await ensureSalesSchema()

  const normalizedPlate = normalizePlate(input.plateNumber)
  const normalizedPhone = normalizePhone(input.phone)
  const normalizedName = normalizeText(input.customerName)
  const clauses: string[] = []
  const bindValues: string[] = []

  if (normalizedPlate.length >= 2) {
    clauses.push(`(vehicles.normalized_plate_number LIKE ? OR ${normalizedLegacyPlateSql} LIKE ?)`)
    bindValues.push(`%${normalizedPlate}%`, `%${normalizedPlate}%`)
  }

  if (normalizedPhone.length >= 4) {
    clauses.push('customers.normalized_phone LIKE ?')
    bindValues.push(`%${normalizedPhone}%`)
  }

  if (normalizedName.length >= 2) {
    clauses.push("LOWER(customers.name) LIKE '%' || LOWER(?) || '%'")
    bindValues.push(input.customerName.trim())
  }

  if (clauses.length === 0) {
    return [] as PlateLookupRow[]
  }

  return selectRows<PlateLookupRow>(
    `SELECT
      vehicles.id AS vehicleId,
      vehicles.customer_id AS customerId,
      CASE
        WHEN TRIM(COALESCE(vehicles.plate_number, '')) <> '' THEN TRIM(vehicles.plate_number)
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${normalizedLegacyPlateSql}) BETWEEN 7 AND 8
          AND ${normalizedLegacyPlateSql} GLOB '*[0-9]*'
          THEN TRIM(COALESCE(vehicles.model_name, ''))
        ELSE ''
      END AS plateNumber,
      COALESCE(NULLIF(customers.name, ''), '미등록 고객') AS customerName,
      COALESCE(customers.phone, '') AS phone,
      CASE
        WHEN COALESCE(vehicles.normalized_plate_number, '') = ''
          AND LENGTH(${normalizedLegacyPlateSql}) BETWEEN 7 AND 8
          AND ${normalizedLegacyPlateSql} GLOB '*[0-9]*'
          THEN ''
        ELSE COALESCE(vehicles.model_name, '')
      END AS vehicleModel,
      COALESCE(vehicles.odometer, 0) AS odometer,
      (
        SELECT MAX(sales.sold_at)
        FROM sales
        WHERE sales.vehicle_id = vehicles.id
      ) AS latestSaleAt
    FROM vehicles
    LEFT JOIN customers
      ON customers.id = vehicles.customer_id
    WHERE ${clauses.join('\n      OR ')}
    ORDER BY
      CASE WHEN COALESCE((
        SELECT MAX(sales.sold_at)
        FROM sales
        WHERE sales.vehicle_id = vehicles.id
      ), '') = '' THEN 1 ELSE 0 END,
      (
        SELECT MAX(sales.sold_at)
        FROM sales
        WHERE sales.vehicle_id = vehicles.id
      ) DESC,
      vehicles.id DESC
    LIMIT 8`,
    bindValues,
  )
}
