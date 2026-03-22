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

  if (!hasCostPriceSnapshot) {
    await execute('ALTER TABLE sale_lines ADD COLUMN cost_price_snapshot INTEGER')
  }
}
