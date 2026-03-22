import type { PublicQuoteFeed, QuoteInquiryInput, QuoteInquiryResponse } from '../../lib/types'

const PUBLIC_QUOTE_API_BASE_URL = import.meta.env.VITE_PUBLIC_QUOTE_API_BASE_URL?.trim() ?? ''

async function parseJsonResponse<T>(response: Response) {
  if (!response.ok) {
    let message = `Request failed with ${response.status}`
    try {
      const payload = await response.json()
      if (typeof payload === 'object' && payload && 'error' in payload) {
        message = String(payload.error)
      }
    } catch {
      // Ignore JSON parse failures and keep the HTTP status message.
    }
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

function buildApiUrl(path: string) {
  if (!PUBLIC_QUOTE_API_BASE_URL) {
    return path
  }

  return `${PUBLIC_QUOTE_API_BASE_URL.replace(/\/$/, '')}${path}`
}

export async function fetchPublicQuoteFeed() {
  const response = await fetch(buildApiUrl('/quote-feed'), {
    headers: {
      Accept: 'application/json',
    },
  })

  return parseJsonResponse<PublicQuoteFeed>(response)
}

export async function submitQuoteInquiry(input: QuoteInquiryInput) {
  const response = await fetch(buildApiUrl('/quote-inquiries'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  })

  return parseJsonResponse<QuoteInquiryResponse>(response)
}
