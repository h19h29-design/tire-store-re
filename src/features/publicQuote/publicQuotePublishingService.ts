import type { PublicQuoteFeed, PublicQuoteItem, PublicQuotePreferences } from '../../lib/types'
import {
  DEFAULT_PUBLIC_QUOTE_NOTICE,
  DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL,
  DEFAULT_PUBLIC_QUOTE_SERVICE_AREA,
  DEFAULT_PUBLIC_QUOTE_STORE_NAME,
  buildPublicQuoteSearchText,
  getDiscountedPrice,
} from './quoteUtils'
import { loadPublicQuotePreferences, savePublicQuotePublishState } from '../settings/settingsService'
import { listPublicQuoteCatalogItems } from '../inventory/inventoryService'

type PublishResponse = {
  ok?: boolean
  message?: string
}

function buildStoreInfo(preferences: PublicQuotePreferences) {
  return {
    storeName: preferences.storeName.trim() || DEFAULT_PUBLIC_QUOTE_STORE_NAME,
    serviceArea: preferences.serviceArea.trim() || DEFAULT_PUBLIC_QUOTE_SERVICE_AREA,
    phoneNumber: preferences.phoneNumber.trim(),
    kakaoUrl: preferences.kakaoUrl.trim(),
    naverStoreUrl: preferences.naverStoreUrl.trim() || DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL,
    defaultInstallationFee: Math.max(0, Math.round(Number(preferences.defaultInstallationFee || 0))),
    defaultAlignmentFee: Math.max(0, Math.round(Number(preferences.defaultAlignmentFee || 0))),
    quoteNotice: preferences.quoteNotice.trim() || DEFAULT_PUBLIC_QUOTE_NOTICE,
  }
}

export async function buildPublicQuoteFeed(
  preferences?: PublicQuotePreferences,
): Promise<PublicQuoteFeed> {
  const resolvedPreferences = preferences ?? (await loadPublicQuotePreferences())
  const items = await listPublicQuoteCatalogItems()
  const lastPublishedAt = new Date().toISOString()

  return {
    store: buildStoreInfo(resolvedPreferences),
    lastPublishedAt,
    items: items.map<PublicQuoteItem>((item) => ({
      skuCode: item.skuCode,
      brandName: item.brandName,
      patternName: item.patternName,
      sizeLabel: item.sizeLabel,
      productName: item.productName,
      quoteUnitPrice: getDiscountedPrice(
        item.defaultCostPrice > 0 ? item.defaultCostPrice : item.defaultSalePrice,
        item.defaultDiscountRate,
      ),
      quoteAvailable: item.quantityAvailable > 0,
      publicQuoteUrl: item.publicQuoteUrl.trim(),
      searchText: buildPublicQuoteSearchText([
        item.brandName,
        item.patternName,
        item.sizeLabel,
        item.productName,
        item.aliasesText,
      ]),
    })),
  }
}

function buildPublishHeaders(preferences: PublicQuotePreferences) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  if (preferences.publishAuthKey.trim()) {
    headers.Authorization = `Bearer ${preferences.publishAuthKey.trim()}`
  }

  return headers
}

export async function publishPublicQuoteFeed(preferences?: PublicQuotePreferences) {
  const resolvedPreferences = preferences ?? (await loadPublicQuotePreferences())

  if (!resolvedPreferences.enabled) {
    throw new Error('Public quote publishing is disabled.')
  }

  if (!resolvedPreferences.publishEndpoint.trim()) {
    throw new Error('Add a publish endpoint before sending the public quote feed.')
  }

  const feed = await buildPublicQuoteFeed(resolvedPreferences)
  const response = await fetch(resolvedPreferences.publishEndpoint.trim(), {
    method: 'POST',
    headers: buildPublishHeaders(resolvedPreferences),
    body: JSON.stringify(feed),
  })

  if (!response.ok) {
    let message = `Publish failed with ${response.status}`

    try {
      const payload = (await response.json()) as PublishResponse
      if (payload.message?.trim()) {
        message = payload.message.trim()
      }
    } catch {
      // Keep the HTTP status derived message.
    }

    throw new Error(message)
  }

  await savePublicQuotePublishState({
    lastPublishedAt: feed.lastPublishedAt,
    lastPublishError: '',
  })

  return feed
}

export async function syncPublicQuoteFeedSilently() {
  const preferences = await loadPublicQuotePreferences()
  if (!preferences.enabled || !preferences.publishEndpoint.trim()) {
    return null
  }

  try {
    return await publishPublicQuoteFeed(preferences)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to publish the public quote feed.'
    await savePublicQuotePublishState({
      lastPublishedAt: preferences.lastPublishedAt,
      lastPublishError: message,
    })
    throw error
  }
}
