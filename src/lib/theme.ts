export type AppTheme = 'classic' | 'premium' | 'hud' | 'mono' | 'pit' | 'frost'

export const APP_THEME_STORAGE_KEY = 'tire-store.appTheme'

export const APP_THEME_OPTIONS: Array<{
  value: AppTheme
  label: string
  description: string
}> = [
  {
    value: 'classic',
    label: '기존 밝은 테마',
    description: '기존 베이지 계열의 익숙한 업무 화면입니다.',
  },
  {
    value: 'premium',
    label: '프리미엄 콘솔',
    description: '다크 네이비와 시안 포인트의 오토서비스 콘솔 테마입니다.',
  },
  {
    value: 'hud',
    label: '슈퍼카 HUD',
    description: '블루 광원과 정교한 프레임이 살아 있는 하이테크 차량 콘솔 테마입니다.',
  },
  {
    value: 'mono',
    label: '모노 그리드 콘솔',
    description: '검정, 흰색, 회색만 사용한 각진 장비형 업무 콘솔 테마입니다.',
  },
  {
    value: 'pit',
    label: '레이싱 피트 시그널',
    description: '정비 베이와 피트 보드에서 가져온 다크 그래파이트와 옐로 포인트 테마입니다.',
  },
  {
    value: 'frost',
    label: '실버 서비스 랩',
    description: '밝은 실버와 유리 패널을 사용한 고급 전기차 서비스 라운지 테마입니다.',
  },
]

const defaultTheme: AppTheme = 'classic'

function isAppTheme(value: unknown): value is AppTheme {
  return value === 'classic' || value === 'premium' || value === 'hud' || value === 'mono' || value === 'pit' || value === 'frost'
}

export function applyAppTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

export function getStoredAppTheme(): AppTheme {
  if (typeof window === 'undefined') return defaultTheme

  try {
    const storedTheme = window.localStorage.getItem(APP_THEME_STORAGE_KEY)
    return isAppTheme(storedTheme) ? storedTheme : defaultTheme
  } catch {
    return defaultTheme
  }
}

export function setStoredAppTheme(theme: AppTheme) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
    } catch {
      // Theme switching should still work even if localStorage is blocked.
    }
  }

  applyAppTheme(theme)
}

export function initializeStoredAppTheme() {
  applyAppTheme(getStoredAppTheme())
}
