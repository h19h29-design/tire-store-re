export function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\da-z\uac00-\ud7a3]/g, '')
}

export function normalizePhone(value: string) {
  return value.replace(/\D/g, '')
}

export function normalizePlate(value: string) {
  return value.replace(/[^\d\uac00-\ud7a3]/g, '')
}

export function scaleMoneyInputToWon(value: number | string) {
  const numericValue =
    typeof value === 'number'
      ? value
      : Number(String(value).replaceAll(',', '').replaceAll('원', '').trim() || '0')

  if (!Number.isFinite(numericValue)) {
    return 0
  }

  return Math.round(numericValue * 1000)
}

export function normalizeSizeLabel(value: string) {
  const digits =
    value
      .toUpperCase()
      .match(/\d+/g)
      ?.flatMap((token) => {
        if (token.length >= 7) {
          return [token.slice(0, 3), token.slice(3, 5), token.slice(5, 7)]
        }
        return [token]
      }) ?? []

  if (digits.length >= 3 && digits[0]?.length === 3) {
    return digits.slice(0, 3).join(' ')
  }

  if (digits.length >= 2 && digits[0]?.length === 3) {
    return digits.slice(0, 2).join(' ')
  }

  return value.trim().replace(/\s+/g, ' ')
}

export function buildSizeSearchTokens(value: string) {
  const sizeLabel = normalizeSizeLabel(value)
  const normalizedSize = normalizeText(sizeLabel)
  const groups = sizeLabel.split(' ').filter(Boolean)
  const rToken =
    groups.length === 3
      ? `${groups[0]}${groups[1]}r${groups[2]}`.toLowerCase()
      : groups.length === 2
        ? `${groups[0]}r${groups[1]}`.toLowerCase()
        : ''

  return Array.from(new Set([normalizeText(value), normalizedSize, rToken].filter(Boolean)))
}

export function getExactSizeSearchToken(value: string) {
  const trimmed = value.trim()
  if (!trimmed || !/^[\dr\s./\\-]+$/i.test(trimmed)) {
    return ''
  }

  const sizeLabel = normalizeSizeLabel(trimmed)
  const groups = sizeLabel.split(' ').filter(Boolean)
  if (groups.length !== 3 || groups[0]?.length !== 3 || groups[2]?.length !== 2) {
    return ''
  }

  return normalizeText(sizeLabel)
}

export function getCurrentSeoulDateTimeValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '00'
  const day = parts.find((part) => part.type === 'day')?.value ?? '00'
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00'
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  const second = parts.find((part) => part.type === 'second')?.value ?? '00'

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('ko-KR').format(value)
}
