import { execute, selectRows } from '../../lib/db'

type TableInfoRow = {
  name: string
}

let ensureSaleLineCostSnapshotSchemaPromise: Promise<void> | null = null

export async function ensureSaleLineCostSnapshotSchema() {
  if (!ensureSaleLineCostSnapshotSchemaPromise) {
    ensureSaleLineCostSnapshotSchemaPromise = applySaleLineCostSnapshotSchema().catch((error) => {
      ensureSaleLineCostSnapshotSchemaPromise = null
      throw error
    })
  }

  await ensureSaleLineCostSnapshotSchemaPromise
}

async function applySaleLineCostSnapshotSchema() {
  const columns = await selectRows<TableInfoRow>('PRAGMA table_info(sale_lines)')
  const hasCostPriceSnapshot = columns.some((column) => column.name === 'cost_price_snapshot')
  const hasSaleBasePriceSnapshot = columns.some((column) => column.name === 'sale_base_price_snapshot')
  const hasSaleDiscountRateSnapshot = columns.some((column) => column.name === 'sale_discount_rate_snapshot')
  const hasDiscountedUnitPriceSnapshot = columns.some((column) => column.name === 'discounted_unit_price_snapshot')

  if (!hasCostPriceSnapshot) {
    await execute('ALTER TABLE sale_lines ADD COLUMN cost_price_snapshot INTEGER')
  }

  if (!hasSaleBasePriceSnapshot) {
    await execute('ALTER TABLE sale_lines ADD COLUMN sale_base_price_snapshot INTEGER')
  }

  if (!hasSaleDiscountRateSnapshot) {
    await execute('ALTER TABLE sale_lines ADD COLUMN sale_discount_rate_snapshot REAL')
  }

  if (!hasDiscountedUnitPriceSnapshot) {
    await execute('ALTER TABLE sale_lines ADD COLUMN discounted_unit_price_snapshot INTEGER')
  }

  await execute(`
    UPDATE sale_lines
    SET sale_base_price_snapshot = COALESCE(cost_price_snapshot, 0)
    WHERE line_type = 'tire'
      AND COALESCE(sale_base_price_snapshot, 0) = 0
      AND COALESCE(cost_price_snapshot, 0) > 0
  `)

  await execute(`
    UPDATE sale_lines
    SET sale_discount_rate_snapshot = (
      SELECT COALESCE(items.default_discount_rate, 0)
      FROM items
      WHERE items.id = sale_lines.item_id
    )
    WHERE line_type = 'tire'
      AND item_id IS NOT NULL
      AND sale_discount_rate_snapshot IS NULL
      AND EXISTS (
        SELECT 1
        FROM items
        WHERE items.id = sale_lines.item_id
      )
  `)

  await execute(`
    UPDATE sale_lines
    SET discounted_unit_price_snapshot = CAST(ROUND(
      COALESCE(sale_base_price_snapshot, cost_price_snapshot, 0)
      * (100 - COALESCE(sale_discount_rate_snapshot, 0))
      / 100.0
    ) AS INTEGER)
    WHERE line_type = 'tire'
      AND COALESCE(discounted_unit_price_snapshot, 0) = 0
      AND COALESCE(sale_base_price_snapshot, cost_price_snapshot, 0) > 0
  `)
}
