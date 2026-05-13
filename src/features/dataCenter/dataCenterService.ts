import { selectCount, selectRows } from '../../lib/db'

export type DataCenterCellValue = string | number | null

export type DataCenterColumn = {
  key: string
  label: string
}

export type DataCenterOrder = {
  column: string
  direction: 'ASC' | 'DESC'
}

export type DataCenterTableConfig = {
  key: string
  tableName: string
  label: string
  description: string
  columns: readonly DataCenterColumn[]
  searchColumns: readonly string[]
  orderBy: readonly DataCenterOrder[]
}

export type DataCenterTableSummary = {
  key: string
  label: string
  description: string
  rowCount: number
  columnCount: number
}

export type DataCenterTableSnapshot = {
  tableKey: string
  tableName: string
  label: string
  description: string
  columns: DataCenterColumn[]
  rows: Array<Record<string, DataCenterCellValue>>
  rowCount: number
  limit: number
  offset: number
}

export const DATA_CENTER_TABLES = [
  {
    key: 'items',
    tableName: 'items',
    label: '재고 품목',
    description: '타이어 품목, 원가, 할인율, 공개 견적 설정',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'brand_name', label: '브랜드' },
      { key: 'pattern_name', label: '패턴' },
      { key: 'size_label', label: '규격' },
      { key: 'product_name', label: '상품명' },
      { key: 'sku_code', label: 'SKU' },
      { key: 'default_cost_price', label: '원가/노출가' },
      { key: 'default_sale_price', label: '기준 판매가' },
      { key: 'default_discount_rate', label: '할인율' },
      { key: 'public_quote_enabled', label: '견적 노출' },
      { key: 'public_quote_url', label: '네이버 URL' },
      { key: 'is_active', label: '사용' },
      { key: 'created_at', label: '생성일' },
      { key: 'updated_at', label: '수정일' },
    ],
    searchColumns: ['brand_name', 'pattern_name', 'size_label', 'product_name', 'sku_code', 'public_quote_url'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'inventory_balance_cache',
    tableName: 'inventory_balance_cache',
    label: '현재 재고 수량',
    description: '품목별 현재 수량 캐시',
    columns: [
      { key: 'item_id', label: '품목 ID' },
      { key: 'quantity_on_hand', label: '보유 수량' },
      { key: 'quantity_reserved', label: '예약 수량' },
      { key: 'quantity_available', label: '가용 수량' },
      { key: 'updated_at', label: '수정일' },
    ],
    searchColumns: ['item_id', 'updated_at'],
    orderBy: [{ column: 'item_id', direction: 'DESC' }],
  },
  {
    key: 'inventory_movements',
    tableName: 'inventory_movements',
    label: '재고 입출고',
    description: '입고, 판매 차감, 조정 등 재고 이동 기록',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'item_id', label: '품목 ID' },
      { key: 'movement_type', label: '이동 유형' },
      { key: 'quantity', label: '수량' },
      { key: 'unit_cost', label: '원가' },
      { key: 'unit_price', label: '단가' },
      { key: 'occurred_at', label: '발생일' },
      { key: 'reference_type', label: '참조 유형' },
      { key: 'reference_id', label: '참조 ID' },
      { key: 'memo', label: '메모' },
      { key: 'created_at', label: '생성일' },
    ],
    searchColumns: ['movement_type', 'occurred_at', 'reference_type', 'memo'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'sales',
    tableName: 'sales',
    label: '판매',
    description: '판매 전표, 고객/차량, 결제 금액',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'sale_number', label: '판매번호' },
      { key: 'sold_at', label: '판매일' },
      { key: 'customer_id', label: '고객 ID' },
      { key: 'vehicle_id', label: '차량 ID' },
      { key: 'total_amount', label: '총액' },
      { key: 'card_amount', label: '카드' },
      { key: 'naver_amount', label: '네이버' },
      { key: 'cash_amount', label: '현금' },
      { key: 'card_fee_rate_basis_points', label: '카드 수수료' },
      { key: 'is_naver_card', label: '네이버 카드' },
      { key: 'memo', label: '메모' },
      { key: 'created_at', label: '생성일' },
      { key: 'updated_at', label: '수정일' },
    ],
    searchColumns: ['sale_number', 'sold_at', 'memo'],
    orderBy: [
      { column: 'sold_at', direction: 'DESC' },
      { column: 'id', direction: 'DESC' },
    ],
  },
  {
    key: 'sale_lines',
    tableName: 'sale_lines',
    label: '판매 상세',
    description: '판매별 타이어/작업 라인과 당시 가격 스냅샷',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'sale_id', label: '판매 ID' },
      { key: 'line_type', label: '라인 유형' },
      { key: 'item_id', label: '품목 ID' },
      { key: 'item_snapshot_name', label: '품목명' },
      { key: 'size_snapshot', label: '규격' },
      { key: 'cost_price_snapshot', label: '원가 스냅샷' },
      { key: 'sale_base_price_snapshot', label: '노출가 스냅샷' },
      { key: 'sale_discount_rate_snapshot', label: '할인율 스냅샷' },
      { key: 'discounted_unit_price_snapshot', label: '도매가 스냅샷' },
      { key: 'quantity', label: '수량' },
      { key: 'unit_price', label: '단가' },
      { key: 'line_total', label: '라인 합계' },
      { key: 'memo', label: '메모' },
      { key: 'created_at', label: '생성일' },
    ],
    searchColumns: ['line_type', 'item_snapshot_name', 'size_snapshot', 'memo'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'work_logs',
    tableName: 'work_logs',
    label: '작업 기록',
    description: '판매에 연결된 작업명, 작업비, 작업일',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'sale_id', label: '판매 ID' },
      { key: 'customer_id', label: '고객 ID' },
      { key: 'vehicle_id', label: '차량 ID' },
      { key: 'work_type', label: '작업명' },
      { key: 'amount', label: '작업비' },
      { key: 'memo', label: '메모' },
      { key: 'worked_at', label: '작업일' },
      { key: 'created_at', label: '생성일' },
    ],
    searchColumns: ['work_type', 'memo', 'worked_at'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'customers',
    tableName: 'customers',
    label: '고객',
    description: '고객명, 연락처, 메모',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: '고객명' },
      { key: 'phone', label: '연락처' },
      { key: 'normalized_phone', label: '정규화 연락처' },
      { key: 'memo', label: '메모' },
      { key: 'created_at', label: '생성일' },
      { key: 'updated_at', label: '수정일' },
    ],
    searchColumns: ['name', 'phone', 'normalized_phone', 'memo'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'vehicles',
    tableName: 'vehicles',
    label: '차량',
    description: '차량번호, 차종, 키로수, 고객 연결',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'customer_id', label: '고객 ID' },
      { key: 'plate_number', label: '차량번호' },
      { key: 'normalized_plate_number', label: '정규화 차량번호' },
      { key: 'brand_name', label: '브랜드' },
      { key: 'model_name', label: '차종' },
      { key: 'odometer', label: '키로수' },
      { key: 'memo', label: '메모' },
      { key: 'created_at', label: '생성일' },
      { key: 'updated_at', label: '수정일' },
    ],
    searchColumns: ['plate_number', 'normalized_plate_number', 'brand_name', 'model_name', 'memo'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'price_history',
    tableName: 'price_history',
    label: '가격 이력',
    description: '품목별 과거 원가/판매가 변경 기록',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'item_id', label: '품목 ID' },
      { key: 'cost_price', label: '원가' },
      { key: 'sale_price', label: '판매가' },
      { key: 'effective_from', label: '적용일' },
      { key: 'memo', label: '메모' },
      { key: 'created_at', label: '생성일' },
    ],
    searchColumns: ['effective_from', 'memo'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'item_aliases',
    tableName: 'item_aliases',
    label: '품목 별칭',
    description: '검색용 품목 별칭과 정규화 값',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'item_id', label: '품목 ID' },
      { key: 'alias_type', label: '별칭 유형' },
      { key: 'alias_value', label: '별칭' },
      { key: 'normalized_alias', label: '정규화 별칭' },
      { key: 'created_at', label: '생성일' },
    ],
    searchColumns: ['alias_type', 'alias_value', 'normalized_alias'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'daily_expenses',
    tableName: 'daily_expenses',
    label: '일별 지출',
    description: '대시보드 일별 지출 금액',
    columns: [
      { key: 'expense_date', label: '지출일' },
      { key: 'amount', label: '금액' },
      { key: 'note', label: '메모' },
      { key: 'updated_at', label: '수정일' },
    ],
    searchColumns: ['expense_date', 'note'],
    orderBy: [{ column: 'expense_date', direction: 'DESC' }],
  },
  {
    key: 'backups',
    tableName: 'backups',
    label: '백업 기록',
    description: '로컬/드라이브 백업 로그',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'backup_path', label: '백업 경로' },
      { key: 'backup_type', label: '백업 유형' },
      { key: 'created_at', label: '생성일' },
      { key: 'note', label: '메모' },
    ],
    searchColumns: ['backup_path', 'backup_type', 'created_at', 'note'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'imports',
    tableName: 'imports',
    label: '가져오기 기록',
    description: '초기 데이터 가져오기 이력',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'source_file', label: '원본 파일' },
      { key: 'imported_at', label: '가져온 일시' },
      { key: 'status', label: '상태' },
      { key: 'note', label: '메모' },
    ],
    searchColumns: ['source_file', 'imported_at', 'status', 'note'],
    orderBy: [{ column: 'id', direction: 'DESC' }],
  },
  {
    key: 'app_settings',
    tableName: 'app_settings',
    label: '앱 설정',
    description: '설정 키와 저장값',
    columns: [
      { key: 'key', label: '키' },
      { key: 'value', label: '값' },
    ],
    searchColumns: ['key', 'value'],
    orderBy: [{ column: 'key', direction: 'ASC' }],
  },
  {
    key: 'tire_brand_reference',
    tableName: 'tire_brand_reference',
    label: '타이어 브랜드 기준',
    description: '타이어 브랜드 기준 데이터',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'brand_name', label: '브랜드' },
      { key: 'normalized_brand', label: '정규화 브랜드' },
      { key: 'source', label: '출처' },
      { key: 'is_active', label: '사용' },
      { key: 'created_at', label: '생성일' },
    ],
    searchColumns: ['brand_name', 'normalized_brand', 'source'],
    orderBy: [{ column: 'id', direction: 'ASC' }],
  },
  {
    key: 'vehicle_brand_reference',
    tableName: 'vehicle_brand_reference',
    label: '차량 브랜드 기준',
    description: '차량 브랜드 기준 데이터',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'brand_name', label: '브랜드' },
      { key: 'normalized_brand', label: '정규화 브랜드' },
      { key: 'source', label: '출처' },
      { key: 'is_active', label: '사용' },
      { key: 'created_at', label: '생성일' },
    ],
    searchColumns: ['brand_name', 'normalized_brand', 'source'],
    orderBy: [{ column: 'id', direction: 'ASC' }],
  },
  {
    key: 'vehicle_model_reference',
    tableName: 'vehicle_model_reference',
    label: '차량 모델 기준',
    description: '차량 브랜드별 모델 기준 데이터',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'brand_name', label: '브랜드' },
      { key: 'model_name', label: '모델' },
      { key: 'normalized_brand', label: '정규화 브랜드' },
      { key: 'normalized_model', label: '정규화 모델' },
      { key: 'source', label: '출처' },
      { key: 'is_active', label: '사용' },
      { key: 'created_at', label: '생성일' },
    ],
    searchColumns: ['brand_name', 'model_name', 'normalized_brand', 'normalized_model', 'source'],
    orderBy: [{ column: 'id', direction: 'ASC' }],
  },
] as const satisfies readonly DataCenterTableConfig[]

export const DEFAULT_DATA_CENTER_TABLE_KEY = 'items'

export function getDataCenterTableConfig(tableKey: string) {
  const config = DATA_CENTER_TABLES.find((table) => table.key === tableKey)
  if (!config) {
    throw new Error('알 수 없는 데이터 표입니다.')
  }
  return config
}

export async function loadDataCenterTableSummaries(): Promise<DataCenterTableSummary[]> {
  const summaries = await Promise.all(
    DATA_CENTER_TABLES.map(async (config) => {
      const rowCount = await selectCount(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(config.tableName)}`)
      return {
        key: config.key,
        label: config.label,
        description: config.description,
        rowCount,
        columnCount: config.columns.length,
      }
    }),
  )

  return summaries
}

export async function loadDataCenterTableSnapshot(
  tableKey: string,
  options: { query?: string; limit?: number; offset?: number } = {},
): Promise<DataCenterTableSnapshot> {
  const config = getDataCenterTableConfig(tableKey)
  const limit = clampPageLimit(options.limit)
  const offset = Math.max(0, Math.round(options.offset ?? 0))
  const selectedColumns = config.columns.map((column) => quoteIdentifier(column.key)).join(', ')
  const where = buildWhereClause(config, options.query ?? '')
  const orderBy = buildOrderBy(config)
  const tableName = quoteIdentifier(config.tableName)

  const rowCount = await selectCount(`SELECT COUNT(*) AS count FROM ${tableName}${where.sql}`, where.bindValues)
  const rows = await selectRows<Record<string, DataCenterCellValue>>(
    `SELECT ${selectedColumns} FROM ${tableName}${where.sql}${orderBy} LIMIT ? OFFSET ?`,
    [...where.bindValues, limit, offset],
  )

  return {
    tableKey: config.key,
    tableName: config.tableName,
    label: config.label,
    description: config.description,
    columns: [...config.columns],
    rows,
    rowCount,
    limit,
    offset,
  }
}

function clampPageLimit(value: number | undefined) {
  if (!value || !Number.isFinite(value)) {
    return 100
  }

  return Math.min(500, Math.max(25, Math.round(value)))
}

function buildWhereClause(config: DataCenterTableConfig, query: string) {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 6)
  if (terms.length === 0 || config.searchColumns.length === 0) {
    return { sql: '', bindValues: [] as string[] }
  }

  const columnConditions = config.searchColumns.map((column) => `CAST(${quoteIdentifier(column)} AS TEXT) LIKE ?`)
  const bindValues: string[] = []
  const termConditions = terms.map((term) => {
    bindValues.push(...config.searchColumns.map(() => `%${term}%`))
    return `(${columnConditions.join(' OR ')})`
  })

  return {
    sql: ` WHERE ${termConditions.join(' AND ')}`,
    bindValues,
  }
}

function buildOrderBy(config: DataCenterTableConfig) {
  if (config.orderBy.length === 0) {
    return ''
  }

  const orderParts = config.orderBy.map((order) => `${quoteIdentifier(order.column)} ${order.direction}`)
  return ` ORDER BY ${orderParts.join(', ')}`
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`안전하지 않은 DB 식별자입니다: ${identifier}`)
  }
  return `"${identifier}"`
}
