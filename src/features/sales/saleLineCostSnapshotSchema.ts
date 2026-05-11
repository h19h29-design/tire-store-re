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
}
