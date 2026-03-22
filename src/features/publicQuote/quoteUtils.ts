import { buildSizeSearchTokens, normalizeSizeLabel, normalizeText } from '../../lib/normalize'
import type { PublicQuoteFeed, PublicQuoteItem, QuoteEstimateInput, QuoteEstimateResult } from '../../lib/types'

export const DEFAULT_PUBLIC_QUOTE_PUBLISH_INTERVAL_MINUTES = 5
export const DEFAULT_PUBLIC_QUOTE_NOTICE = '재고 및 최종 금액은 상담 후 확정됩니다.'
export const DEFAULT_PUBLIC_QUOTE_STORE_NAME = '타이어스토어 식사점'
export const DEFAULT_PUBLIC_QUOTE_SERVICE_AREA = '일산 · 파주'
export const DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL = 'https://smartstore.naver.com/tire_sotre'
export const PUBLIC_QUOTE_STALE_MINUTES = 30

function sanitizeAmount(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.round(value))
}

export function getDiscountedPrice(defaultSalePrice: number, discountRate: number) {
  const salePrice = sanitizeAmount(defaultSalePrice)
  const normalizedRate = Math.max(0, Math.min(100, Number(discountRate || 0)))
  if (salePrice <= 0 || normalizedRate <= 0) {
    return salePrice
  }

  return Math.max(0, Math.round((salePrice * (100 - normalizedRate)) / 100))
}

export function buildPublicQuoteSearchText(values: string[]) {
  const tokens = new Set<string>()

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) {
      continue
    }

    const normalized = normalizeText(trimmed)
    if (normalized) {
      tokens.add(normalized)
    }

    for (const part of trimmed.split(/\s+/)) {
      const normalizedPart = normalizeText(part)
      if (normalizedPart) {
        tokens.add(normalizedPart)
      }
    }

    for (const sizeToken of buildSizeSearchTokens(trimmed)) {
      const normalizedSizeToken = normalizeText(sizeToken)
      if (normalizedSizeToken) {
        tokens.add(normalizedSizeToken)
      }
    }
  }

  return Array.from(tokens).join(' ')
}

export function createDefaultPublicQuoteFeed(): PublicQuoteFeed {
  return {
    store: {
      storeName: DEFAULT_PUBLIC_QUOTE_STORE_NAME,
      serviceArea: DEFAULT_PUBLIC_QUOTE_SERVICE_AREA,
      phoneNumber: '',
      kakaoUrl: '',
      naverStoreUrl: DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL,
      defaultInstallationFee: 0,
      defaultAlignmentFee: 0,
      quoteNotice: DEFAULT_PUBLIC_QUOTE_NOTICE,
    },
    lastPublishedAt: null,
    items: [],
  }
}

export function isPublicQuoteFeedStale(lastPublishedAt: string | null, maxAgeMinutes = PUBLIC_QUOTE_STALE_MINUTES) {
  if (!lastPublishedAt) {
    return true
  }

  const publishedAt = Date.parse(lastPublishedAt)
  if (!Number.isFinite(publishedAt)) {
    return true
  }

  return Date.now() - publishedAt > maxAgeMinutes * 60_000
}

function buildQuoteSearchTokens(input: QuoteEstimateInput) {
  const tokens = new Set<string>()

  for (const token of input.vehicleQuery.split(/\s+/)) {
    const normalized = normalizeText(token)
    if (normalized) {
      tokens.add(normalized)
    }
  }

  for (const token of buildSizeSearchTokens(input.sizeLabel)) {
    const normalized = normalizeText(token)
    if (normalized) {
      tokens.add(normalized)
    }
  }

  const normalizedBrand = normalizeText(input.brandName)
  if (normalizedBrand) {
    tokens.add(normalizedBrand)
  }

  return Array.from(tokens)
}

function countMatchedTokens(searchText: string, tokens: string[]) {
  return tokens.reduce((count, token) => (searchText.includes(token) ? count + 1 : count), 0)
}

export function matchPublicQuoteItems(feed: PublicQuoteFeed, input: QuoteEstimateInput) {
  const normalizedBrand = normalizeText(input.brandName)
  const normalizedRequestedSize = normalizeText(normalizeSizeLabel(input.sizeLabel))
  const tokens = buildQuoteSearchTokens(input)

  const items = feed.items.filter((item) => {
    const searchText = item.searchText || buildPublicQuoteSearchText([
      item.brandName,
      item.patternName,
      item.sizeLabel,
      item.productName,
    ])

    if (normalizedBrand && normalizeText(item.brandName) !== normalizedBrand) {
      return false
    }

    if (tokens.length === 0) {
      return true
    }

    return countMatchedTokens(searchText, tokens) > 0
  })

  return items
    .sort((left, right) => {
      const leftSearchText = left.searchText || ''
      const rightSearchText = right.searchText || ''
      const leftMatches = countMatchedTokens(leftSearchText, tokens)
      const rightMatches = countMatchedTokens(rightSearchText, tokens)
      const leftExactSize = normalizedRequestedSize && normalizeText(left.sizeLabel) === normalizedRequestedSize ? 1 : 0
      const rightExactSize = normalizedRequestedSize && normalizeText(right.sizeLabel) === normalizedRequestedSize ? 1 : 0
      const leftAvailable = left.quoteAvailable ? 1 : 0
      const rightAvailable = right.quoteAvailable ? 1 : 0

      return (
        rightAvailable - leftAvailable ||
        rightExactSize - leftExactSize ||
        rightMatches - leftMatches ||
        left.quoteUnitPrice - right.quoteUnitPrice ||
        left.brandName.localeCompare(right.brandName, 'ko-KR') ||
        left.sizeLabel.localeCompare(right.sizeLabel, 'ko-KR')
      )
    })
    .slice(0, 12)
}

export function buildQuoteEstimate(
  item: PublicQuoteItem,
  feed: PublicQuoteFeed,
  input: QuoteEstimateInput,
): QuoteEstimateResult {
  const quantity = input.quantity
  const tireSubtotal = sanitizeAmount(item.quoteUnitPrice) * quantity
  const installationFee = input.includeInstallation ? sanitizeAmount(feed.store.defaultInstallationFee) * quantity : 0
  const alignmentFee = input.includeAlignment ? sanitizeAmount(feed.store.defaultAlignmentFee) : 0
  const serviceTotal = installationFee + alignmentFee

  return {
    item,
    quantity,
    includeInstallation: input.includeInstallation,
    includeAlignment: input.includeAlignment,
    tireSubtotal,
    serviceTotal,
    totalEstimate: tireSubtotal + serviceTotal,
    notice: feed.store.quoteNotice.trim() || DEFAULT_PUBLIC_QUOTE_NOTICE,
    lastPublishedAt: feed.lastPublishedAt,
    isStale: isPublicQuoteFeedStale(feed.lastPublishedAt),
  }
}
