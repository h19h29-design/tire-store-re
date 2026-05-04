import { execute, selectFirst, selectRows, runTransaction } from '../../lib/db'
import { loadLowStockThresholdSetting } from '../../lib/appSettings'
import {
  getCurrentSeoulDateTimeValue,
  getExactSizeSearchToken,
  normalizePatternText,
  normalizeSizeLabel,
  normalizeText,
} from '../../lib/normalize'
import { loadBrandDiscountRules, loadProductDiscountRules } from '../settings/settingsService'
import type {
  InventoryCatalogSettingsInput,
  InventoryCreateItemInput,
  InventoryFilterOptions,
  InventoryListRow,
  InventoryOverview,
  InventorySearchFilters,
  StockEntryInput,
} from '../../lib/types'

void runTransaction

type BalanceRow = {
  quantityOnHand: number
  quantityAvailable: number
}

type OptionRow = {
  value: string
}

type TableInfoRow = {
  name: string
}

type InventoryOverviewRow = {
  totalQuantity: number
  itemCount: number
  lowStockItemCount: number
}

type DiscountableRow = {
  brandName: string
  patternName: string
  productName: string
  defaultDiscountRate: number
}

type InventoryListQueryRow = Omit<InventoryListRow, 'publicQuoteEnabled'> & {
  publicQuoteEnabled: number
}

type PublicQuoteCatalogItem = InventoryListRow & {
  aliasesText: string
}

let inventorySchemaPromise: Promise<void> | null = null

const defaultFilters: InventorySearchFilters = {
  query: '',
  brandName: '',
  patternName: '',
  sizeLabel: '',
  receivedDate: '',
  stockMode: 'all',
}

const latestReceivedAtSql = `(
  SELECT MAX(inventory_movements.occurred_at)
  FROM inventory_movements
  WHERE inventory_movements.item_id = items.id
    AND inventory_movements.quantity > 0
)`

const normalizedProductSql = `LOWER(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(COALESCE(items.product_name, ''), ' ', ''),
            '-',
            ''
          ),
          '/',
          ''
        ),
        '.',
        ''
      ),
      '(',
      ''
    ),
    ')',
    ''
  )
)`
const normalizedPatternLabelSql = `LOWER(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(COALESCE(items.pattern_name, ''), ' ', ''),
          '-',
          ''
        ),
        '/',
        ''
      ),
      '.',
      ''
    ),
    '＋',
    '+'
  )
)`
const normalizedAliasLabelSql = `LOWER(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(COALESCE(item_aliases.alias_value, ''), ' ', ''),
          '-',
          ''
        ),
        '/',
        ''
      ),
      '.',
      ''
    ),
    '＋',
    '+'
  )
)`
function buildDigitsOnlySql(expression: string) {
  return 'abcdefghijklmnopqrstuvwxyz'.split('').reduce(
    (result, character) => `REPLACE(${result}, '${character}', '')`,
    `LOWER(COALESCE(${expression}, ''))`,
  )
}

const sizeDigitsSql = buildDigitsOnlySql('items.normalized_size')
const aliasDigitsSql = buildDigitsOnlySql('item_aliases.normalized_alias')

function normalizeDiscountRate(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

function normalizeOccurredAtDate(value: string) {
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : getCurrentSeoulDateTimeValue().slice(0, 10)
}

function buildOccurredAtValue(dateValue: string) {
  const currentTime = getCurrentSeoulDateTimeValue().slice(11, 19)
  return `${normalizeOccurredAtDate(dateValue)} ${currentTime}`
}

async function ensureInventorySchema() {
  inventorySchemaPromise ??= (async () => {
    const itemColumns = await selectRows<TableInfoRow>('PRAGMA table_info(items)')
    const hasDefaultDiscountRate = itemColumns.some((row) => row.name === 'default_discount_rate')
    const hasPublicQuoteEnabled = itemColumns.some((row) => row.name === 'public_quote_enabled')
    const hasPublicQuoteUrl = itemColumns.some((row) => row.name === 'public_quote_url')

    if (!hasDefaultDiscountRate) {
      await execute('ALTER TABLE items ADD COLUMN default_discount_rate REAL NOT NULL DEFAULT 0')
    }

    if (!hasPublicQuoteEnabled) {
      await execute('ALTER TABLE items ADD COLUMN public_quote_enabled INTEGER NOT NULL DEFAULT 0')
    }

    if (!hasPublicQuoteUrl) {
      await execute("ALTER TABLE items ADD COLUMN public_quote_url TEXT NOT NULL DEFAULT ''")
    }
  })()

  return inventorySchemaPromise
}

async function applyDiscountRules<T extends DiscountableRow>(rows: T[]) {
  const [brandRules, productRules] = await Promise.all([
    loadBrandDiscountRules(),
    loadProductDiscountRules(),
  ])

  if (brandRules.length === 0 && productRules.length === 0) {
    return rows.map((row) => ({
      ...row,
      defaultDiscountRate: normalizeDiscountRate(row.defaultDiscountRate),
    }))
  }

  const brandDiscountMap = new Map(
    brandRules.map((rule) => [normalizeText(rule.brandName), normalizeDiscountRate(rule.discountRate)]),
  )
  const productDiscountMap = new Map(
    productRules.map((rule) => [normalizeText(rule.productName), normalizeDiscountRate(rule.discountRate)]),
  )

  return rows.map((row) => ({
    ...row,
    defaultDiscountRate: Math.max(
      normalizeDiscountRate(row.defaultDiscountRate),
      brandDiscountMap.get(normalizeText(row.brandName)) ?? 0,
      productDiscountMap.get(normalizeText(row.patternName)) ?? 0,
      productDiscountMap.get(normalizeText(row.productName)) ?? 0,
    ),
  }))
}

export async function searchInventoryItems(
  filters: string | Partial<InventorySearchFilters> = {},
) {
  await ensureInventorySchema()
  const mergedFilters =
    typeof filters === 'string'
      ? { ...defaultFilters, query: filters }
      : { ...defaultFilters, ...filters }
  const normalizedBrand = normalizeText(mergedFilters.brandName)
  const exactSizeSearchToken = getExactSizeSearchToken(mergedFilters.query)
  const searchTokens = exactSizeSearchToken ? [] : buildSearchTokens(mergedFilters.query)

  const params: Array<string> = [
    normalizedBrand,
    normalizedBrand,
    mergedFilters.patternName,
    mergedFilters.patternName,
    mergedFilters.sizeLabel,
    mergedFilters.sizeLabel,
    mergedFilters.receivedDate,
    mergedFilters.receivedDate,
    mergedFilters.stockMode,
    mergedFilters.stockMode,
    mergedFilters.stockMode,
  ]

  const exactSizeClause = exactSizeSearchToken
    ? `\n      AND (
        items.normalized_size = ?
        OR ${sizeDigitsSql} = ?
        OR EXISTS (
          SELECT 1
          FROM item_aliases
          WHERE item_aliases.item_id = items.id
            AND ${aliasDigitsSql} = ?
        )
      )`
    : ''

  if (exactSizeSearchToken) {
    params.push(exactSizeSearchToken, exactSizeSearchToken, exactSizeSearchToken)
  }

  const tokenClauses = searchTokens.map((token) => {
    const likeValue = `%${token}%`

    if (isSizeMarkerToken(token)) {
      params.push(likeValue, likeValue)
      return `(
        items.normalized_size LIKE ?
        OR EXISTS (
          SELECT 1
          FROM item_aliases
          WHERE item_aliases.item_id = items.id
            AND item_aliases.normalized_alias LIKE ?
        )
      )`
    }

    if (isPatternCodeToken(token)) {
      params.push(token, token)
      return `(
        ${normalizedPatternLabelSql} = ?
        OR EXISTS (
          SELECT 1
          FROM item_aliases
          WHERE item_aliases.item_id = items.id
            AND ${normalizedAliasLabelSql} = ?
        )
      )`
    }

    const tokenParts = [
      'items.normalized_brand LIKE ?',
      'items.normalized_pattern LIKE ?',
      `${normalizedPatternLabelSql} LIKE ?`,
      'items.normalized_size LIKE ?',
      "LOWER(COALESCE(items.sku_code, '')) LIKE ?",
      `${normalizedProductSql} LIKE ?`,
      `EXISTS (
        SELECT 1
        FROM item_aliases
        WHERE item_aliases.item_id = items.id
          AND item_aliases.normalized_alias LIKE ?
      )`,
    ]

    params.push(likeValue, likeValue, likeValue, likeValue, likeValue, likeValue, likeValue)

    if (/^\d+$/.test(token)) {
      tokenParts.push(`${sizeDigitsSql} LIKE ?`)
      params.push(likeValue)
    }

    return `(${tokenParts.join('\n        OR ')})`
  })

  const queryClause =
    tokenClauses.length > 0 ? `\n      AND ${tokenClauses.join('\n      AND ')}` : ''

  const rows = await selectRows<InventoryListQueryRow>(
    `SELECT
      items.id AS id,
      items.sku_code AS skuCode,
      items.brand_name AS brandName,
      items.pattern_name AS patternName,
      items.size_label AS sizeLabel,
      items.product_name AS productName,
      COALESCE(items.default_cost_price, 0) AS defaultCostPrice,
      items.default_sale_price AS defaultSalePrice,
      COALESCE(items.default_discount_rate, 0) AS defaultDiscountRate,
      COALESCE(inventory_balance_cache.quantity_on_hand, 0) AS quantityOnHand,
      COALESCE(inventory_balance_cache.quantity_available, 0) AS quantityAvailable,
      ${latestReceivedAtSql} AS latestReceivedAt,
      COALESCE(items.public_quote_enabled, 0) AS publicQuoteEnabled,
      COALESCE(items.public_quote_url, '') AS publicQuoteUrl
    FROM items
    LEFT JOIN inventory_balance_cache
      ON inventory_balance_cache.item_id = items.id
    WHERE items.is_active = 1
      AND (? = '' OR items.normalized_brand = ?)
      AND (? = '' OR items.pattern_name = ?)
      AND (? = '' OR items.size_label = ?)
      AND (? = '' OR DATE(${latestReceivedAtSql}) = ?)
      AND (
        ? = 'all'
        OR (? = 'in-stock' AND COALESCE(inventory_balance_cache.quantity_available, 0) > 0)
        OR (? = 'out-of-stock' AND COALESCE(inventory_balance_cache.quantity_available, 0) <= 0)
      )
      ${exactSizeClause}
      ${queryClause}
    ORDER BY
      CASE WHEN COALESCE(inventory_balance_cache.quantity_available, 0) > 0 THEN 0 ELSE 1 END,
      COALESCE(inventory_balance_cache.quantity_available, 0) DESC,
      items.normalized_brand ASC,
      items.normalized_size ASC,
      items.normalized_pattern ASC
    LIMIT 300`,
    params,
  )

  const discountedRows = await applyDiscountRules(rows)

  return discountedRows.map((row) => ({
    ...row,
    publicQuoteEnabled: Boolean(Number(row.publicQuoteEnabled)),
    publicQuoteUrl: row.publicQuoteUrl ?? '',
  }))
}

export async function getInventoryFilterOptions(): Promise<InventoryFilterOptions> {
  await ensureInventorySchema()
  const [brands, patterns, sizes] = await Promise.all([
    selectRows<OptionRow>(
      `SELECT DISTINCT brand_name AS value
      FROM items
      WHERE is_active = 1 AND TRIM(brand_name) <> ''
      ORDER BY brand_name ASC`,
    ),
    selectRows<OptionRow>(
      `SELECT DISTINCT pattern_name AS value
      FROM items
      WHERE is_active = 1 AND TRIM(pattern_name) <> ''
      ORDER BY pattern_name ASC`,
    ),
    selectRows<OptionRow>(
      `SELECT DISTINCT size_label AS value
      FROM items
      WHERE is_active = 1 AND TRIM(size_label) <> ''
      ORDER BY size_label ASC`,
    ),
  ])

  return {
    brands: brands.map((row) => row.value),
    patterns: patterns.map((row) => row.value),
    sizes: sizes.map((row) => row.value),
  }
}

export async function getLowStockThreshold() {
  return loadLowStockThresholdSetting()
}

export async function getInventoryOverview(): Promise<InventoryOverview> {
  await ensureInventorySchema()
  const lowStockThreshold = await loadLowStockThresholdSetting()
  const row = await selectFirst<InventoryOverviewRow>(
    `SELECT
      COALESCE(SUM(COALESCE(inventory_balance_cache.quantity_on_hand, 0)), 0) AS totalQuantity,
      COUNT(*) AS itemCount,
      COALESCE(SUM(CASE
        WHEN COALESCE(inventory_balance_cache.quantity_available, 0) > 0
          AND COALESCE(inventory_balance_cache.quantity_available, 0) <= ?
        THEN 1
        ELSE 0
      END), 0) AS lowStockItemCount
    FROM items
    LEFT JOIN inventory_balance_cache
      ON inventory_balance_cache.item_id = items.id
    WHERE items.is_active = 1`,
    [lowStockThreshold],
  )

  return {
    totalQuantity: Number(row?.totalQuantity ?? 0),
    itemCount: Number(row?.itemCount ?? 0),
    lowStockItemCount: Number(row?.lowStockItemCount ?? 0),
  }
}

export async function saveStockEntry(input: StockEntryInput) {
  await ensureInventorySchema()
  const targetQuantity = Math.max(0, Math.floor(Number(input.quantity) || 0))
  if (!Number.isFinite(targetQuantity) || targetQuantity < 0) {
    throw new Error('재고 수량은 0개 이상으로 입력해 주세요.')
  }

  const balanceRow = await selectFirst<BalanceRow>(
    `SELECT
      quantity_on_hand AS quantityOnHand,
      quantity_available AS quantityAvailable
    FROM inventory_balance_cache
    WHERE item_id = ?`,
    [input.itemId],
  )

  const currentQuantityOnHand = Math.max(0, Number(balanceRow?.quantityOnHand ?? 0))
  const currentAvailable = Number(balanceRow?.quantityAvailable ?? 0)
  const signedQuantity = targetQuantity - currentQuantityOnHand
  if (currentAvailable + signedQuantity < 0) {
    throw new Error('현재 사용 가능한 재고보다 적게 맞출 수는 없습니다.')
  }

  const occurredAt = buildOccurredAtValue(input.occurredAt)
  const movementType = signedQuantity >= 0 ? 'receive' : 'adjustment'

  if (signedQuantity !== 0) {
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
      ) VALUES (?, ?, ?, ?, 0, ?, 'manual', NULL, ?)`,
      [
        input.itemId,
        movementType,
        signedQuantity,
        Math.max(0, input.unitCost),
        occurredAt,
        input.memo.trim(),
      ],
    )

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
      [input.itemId, signedQuantity, signedQuantity],
    )
  } else {
    await execute(
      `UPDATE inventory_movements
      SET
        occurred_at = ?,
        unit_cost = CASE WHEN ? > 0 THEN ? ELSE unit_cost END,
        memo = CASE WHEN ? <> '' THEN ? ELSE memo END
      WHERE id = (
        SELECT id
        FROM inventory_movements
        WHERE item_id = ?
          AND quantity > 0
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
      )`,
      [
        occurredAt,
        Math.max(0, input.unitCost),
        Math.max(0, input.unitCost),
        input.memo.trim(),
        input.memo.trim(),
        input.itemId,
      ],
    )
  }

  if (input.unitCost > 0) {
    await execute(
      `UPDATE items
      SET
        default_cost_price = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [Math.max(0, input.unitCost), input.itemId],
    )

    await execute(
      `INSERT INTO price_history (
        item_id,
        cost_price,
        sale_price,
        effective_from,
        memo
      )
      SELECT
        id,
        ?,
        default_sale_price,
        ?,
        ?
      FROM items
      WHERE id = ?`,
      [
        Math.max(0, input.unitCost),
        occurredAt,
        signedQuantity === 0 ? '재고 날짜/원가 수정에서 원가 갱신' : '재고 입력에서 원가 갱신',
        input.itemId,
      ],
    )
  }
}

export async function saveItemDiscountRate(itemId: number, discountRate: number) {
  await ensureInventorySchema()
  await execute(
    `UPDATE items
    SET
      default_discount_rate = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [normalizeDiscountRate(discountRate), itemId],
  )
}

export async function saveItemCatalogSettings(
  itemId: number,
  input: InventoryCatalogSettingsInput,
) {
  await ensureInventorySchema()

  const brandName = input.brandName.trim()
  const patternName = input.patternName.trim()
  const sizeLabel = normalizeSizeLabel(input.sizeLabel)
  const normalizedBrand = normalizeText(brandName)
  const normalizedPattern = normalizePatternText(patternName)
  const normalizedSize = normalizeText(sizeLabel)

  if (!brandName || !patternName || !sizeLabel) {
    throw new Error('브랜드, 패턴, 규격은 반드시 입력해 주세요.')
  }

  if (!normalizedBrand || !normalizedPattern || !normalizedSize) {
    throw new Error('브랜드, 패턴, 규격 값이 올바르지 않습니다.')
  }

  const skuCodeBase = `${normalizedBrand}__${normalizedPattern}__${normalizedSize}`
  const skuCode = await buildUniqueSkuCode(skuCodeBase, itemId)

  await execute(
    `UPDATE items
    SET
      sku_code = ?,
      brand_name = ?,
      pattern_name = ?,
      size_label = ?,
      normalized_brand = ?,
      normalized_pattern = ?,
      normalized_size = ?,
      default_cost_price = ?,
      default_discount_rate = ?,
      public_quote_enabled = ?,
      public_quote_url = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [
      skuCode,
      brandName,
      patternName,
      sizeLabel,
      normalizedBrand,
      normalizedPattern,
      normalizedSize,
      Math.max(0, Math.round(Number(input.defaultCostPrice) || 0)),
      normalizeDiscountRate(input.discountRate),
      input.publicQuoteEnabled ? 1 : 0,
      input.publicQuoteUrl.trim(),
      itemId,
    ],
  )

  await execute(
    `INSERT INTO item_aliases (item_id, alias_type, alias_value, normalized_alias)
    VALUES (?, 'manual', ?, ?)
    ON CONFLICT(item_id, normalized_alias) DO NOTHING`,
      [itemId, patternName, normalizedPattern],
  )
}

export async function getInventoryItemById(itemId: number): Promise<InventoryListRow | null> {
  await ensureInventorySchema()

  const rows = await selectRows<InventoryListQueryRow>(
    `SELECT
      items.id AS id,
      items.sku_code AS skuCode,
      items.brand_name AS brandName,
      items.pattern_name AS patternName,
      items.size_label AS sizeLabel,
      items.product_name AS productName,
      COALESCE(items.default_cost_price, 0) AS defaultCostPrice,
      items.default_sale_price AS defaultSalePrice,
      COALESCE(items.default_discount_rate, 0) AS defaultDiscountRate,
      COALESCE(inventory_balance_cache.quantity_on_hand, 0) AS quantityOnHand,
      COALESCE(inventory_balance_cache.quantity_available, 0) AS quantityAvailable,
      ${latestReceivedAtSql} AS latestReceivedAt,
      COALESCE(items.public_quote_enabled, 0) AS publicQuoteEnabled,
      COALESCE(items.public_quote_url, '') AS publicQuoteUrl
    FROM items
    LEFT JOIN inventory_balance_cache
      ON inventory_balance_cache.item_id = items.id
    WHERE items.id = ?
      AND items.is_active = 1
    LIMIT 1`,
    [itemId],
  )

  const [row] = await applyDiscountRules(rows)
  if (!row) {
    return null
  }

  return {
    ...row,
    publicQuoteEnabled: Boolean(Number(row.publicQuoteEnabled)),
    publicQuoteUrl: row.publicQuoteUrl ?? '',
  }
}

export async function listPublicQuoteCatalogItems(): Promise<PublicQuoteCatalogItem[]> {
  await ensureInventorySchema()

  const rows = await selectRows<
    Omit<PublicQuoteCatalogItem, 'publicQuoteEnabled'> & {
      publicQuoteEnabled: number
    }
  >(
    `SELECT
      items.id AS id,
      items.sku_code AS skuCode,
      items.brand_name AS brandName,
      items.pattern_name AS patternName,
      items.size_label AS sizeLabel,
      items.product_name AS productName,
      COALESCE(items.default_cost_price, 0) AS defaultCostPrice,
      items.default_sale_price AS defaultSalePrice,
      COALESCE(items.default_discount_rate, 0) AS defaultDiscountRate,
      COALESCE(inventory_balance_cache.quantity_on_hand, 0) AS quantityOnHand,
      COALESCE(inventory_balance_cache.quantity_available, 0) AS quantityAvailable,
      ${latestReceivedAtSql} AS latestReceivedAt,
      COALESCE(items.public_quote_enabled, 0) AS publicQuoteEnabled,
      COALESCE(items.public_quote_url, '') AS publicQuoteUrl,
      COALESCE(GROUP_CONCAT(item_aliases.alias_value, ' '), '') AS aliasesText
    FROM items
    LEFT JOIN inventory_balance_cache
      ON inventory_balance_cache.item_id = items.id
    LEFT JOIN item_aliases
      ON item_aliases.item_id = items.id
    WHERE items.is_active = 1
      AND COALESCE(items.public_quote_enabled, 0) = 1
    GROUP BY items.id
    ORDER BY
      CASE WHEN COALESCE(inventory_balance_cache.quantity_available, 0) > 0 THEN 0 ELSE 1 END,
      items.normalized_brand ASC,
      items.normalized_size ASC,
      items.normalized_pattern ASC`,
  )

  const discountedRows = await applyDiscountRules(rows)

  return discountedRows.map((row) => ({
    ...row,
    publicQuoteEnabled: Boolean(Number(row.publicQuoteEnabled)),
    publicQuoteUrl: row.publicQuoteUrl ?? '',
    aliasesText: row.aliasesText ?? '',
  }))
}

function collectAliases(input: InventoryCreateItemInput) {
  const aliases = new Set<string>()
  const candidates = [input.patternName, input.productName ?? '']
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    const normalized = normalizePatternText(trimmed)
    if (!trimmed || !normalized) {
      continue
    }
    aliases.add(trimmed)
  }
  return [...aliases]
}

function buildItemIdentity(input: Pick<InventoryCreateItemInput, 'brandName' | 'patternName' | 'sizeLabel'>) {
  const brandName = input.brandName.trim()
  const patternName = input.patternName.trim()
  const sizeLabel = normalizeSizeLabel(input.sizeLabel)
  const normalizedBrand = normalizeText(brandName)
  const normalizedPattern = normalizePatternText(patternName)
  const normalizedSize = normalizeText(sizeLabel)

  return {
    brandName,
    patternName,
    sizeLabel,
    normalizedBrand,
    normalizedPattern,
    normalizedSize,
    skuCodeBase: `${normalizedBrand}__${normalizedPattern}__${normalizedSize}`,
  }
}

async function buildUniqueSkuCode(baseSkuCode: string, excludeItemId?: number) {
  const query =
    `SELECT sku_code AS skuCode
    FROM items
    WHERE (sku_code = ? OR sku_code LIKE ?)` +
    (Number.isInteger(excludeItemId) && Number(excludeItemId) > 0 ? '\n      AND id <> ?' : '')
  const params =
    Number.isInteger(excludeItemId) && Number(excludeItemId) > 0
      ? [baseSkuCode, `${baseSkuCode}__dup%`, Number(excludeItemId)]
      : [baseSkuCode, `${baseSkuCode}__dup%`]
  const existingRows = await selectRows<{ skuCode: string }>(query, params)
  const existingSkuCodes = new Set(existingRows.map((row) => row.skuCode))

  if (!existingSkuCodes.has(baseSkuCode)) {
    return baseSkuCode
  }

  let suffix = 2
  while (existingSkuCodes.has(`${baseSkuCode}__dup${suffix}`)) {
    suffix += 1
  }

  return `${baseSkuCode}__dup${suffix}`
}

export async function createInventoryItem(input: InventoryCreateItemInput) {
  await ensureInventorySchema()

  const { brandName, patternName, sizeLabel, normalizedBrand, normalizedPattern, normalizedSize, skuCodeBase } =
    buildItemIdentity(input)
  const productName = (input.productName ?? '').trim()
  const defaultCostPrice = Math.max(0, Math.round(Number(input.defaultCostPrice) || 0))
  const defaultSalePrice = Math.max(0, Math.round(Number(input.defaultSalePrice) || 0))
  const defaultDiscountRate = normalizeDiscountRate(input.defaultDiscountRate)
  const initialQuantity = Math.max(0, Math.floor(Number(input.initialQuantity) || 0))
  const memo = input.memo.trim()
  const publicQuoteEnabled = Boolean(input.publicQuoteEnabled)
  const publicQuoteUrl = input.publicQuoteUrl.trim()

  if (!brandName || !patternName || !sizeLabel) {
    throw new Error('브랜드, 패턴, 규격은 반드시 입력해 주세요.')
  }

  if (!normalizedBrand || !normalizedPattern || !normalizedSize) {
    throw new Error('규격 또는 패턴 값이 올바르지 않습니다.')
  }

  const skuCode = await buildUniqueSkuCode(skuCodeBase)

  const itemInsert = await execute(
    `INSERT INTO items (
      sku_code,
      brand_name,
      pattern_name,
      size_label,
      normalized_brand,
      normalized_pattern,
      normalized_size,
      product_name,
      default_cost_price,
      default_sale_price,
      default_discount_rate,
      public_quote_enabled,
      public_quote_url,
      is_active,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
    [
      skuCode,
      brandName,
      patternName,
      sizeLabel,
      normalizedBrand,
      normalizedPattern,
      normalizedSize,
      productName,
      defaultCostPrice,
      defaultSalePrice,
      defaultDiscountRate,
      publicQuoteEnabled ? 1 : 0,
      publicQuoteUrl,
    ],
  )

  const itemId = Number(itemInsert.lastInsertId)
  const aliases = collectAliases(input)
  const createdAt = getCurrentSeoulDateTimeValue()

  for (const alias of aliases) {
    await execute(
      `INSERT INTO item_aliases (item_id, alias_type, alias_value, normalized_alias)
      VALUES (?, 'manual', ?, ?)
      ON CONFLICT(item_id, normalized_alias) DO NOTHING`,
      [itemId, alias, normalizePatternText(alias)],
    )
  }

  await execute(
    `INSERT INTO inventory_balance_cache (
      item_id,
      quantity_on_hand,
      quantity_reserved,
      quantity_available,
      updated_at
    ) VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP)`,
    [itemId, initialQuantity, initialQuantity],
  )

  if (initialQuantity > 0) {
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
      ) VALUES (?, 'receive', ?, ?, ?, ?, 'manual', NULL, ?)`,
      [itemId, initialQuantity, defaultCostPrice, defaultSalePrice, createdAt, memo || '신규 품목 등록'],
    )
  }

  if (defaultCostPrice > 0 || defaultSalePrice > 0) {
    await execute(
      `INSERT INTO price_history (
        item_id,
        cost_price,
        sale_price,
        effective_from,
        memo
      ) VALUES (?, ?, ?, ?, ?)`,
      [itemId, defaultCostPrice, defaultSalePrice, createdAt, memo || '신규 품목 등록'],
    )
  }

  return itemId
}

export async function deleteInventoryItem(itemId: number) {
  await ensureInventorySchema()
  await execute(
    `UPDATE items
    SET
      is_active = 0,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [itemId],
  )
}

function buildSearchTokens(query: string) {
  return Array.from(
    new Set(
      query
        .split(/\s+/)
        .map((token) => normalizePatternText(token))
        .filter(Boolean),
    ),
  )
}

function isSizeMarkerToken(token: string) {
  return /^[a-z]$/.test(token)
}

function isPatternCodeToken(token: string) {
  return /^[a-z]{1,6}\d{1,5}\+?$/.test(token)
}

