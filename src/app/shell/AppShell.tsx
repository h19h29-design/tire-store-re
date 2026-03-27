import { useEffect, useEffectEvent, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { ensureRuntimeReady } from '../../lib/desktop'
import { isDesktopApp } from '../../lib/platform'
import { ensureReferenceData } from '../../lib/referenceData'
import { syncPublicQuoteFeedSilently } from '../../features/publicQuote/publicQuotePublishingService'
import { DEFAULT_PUBLIC_QUOTE_PUBLISH_INTERVAL_MINUTES } from '../../features/publicQuote/quoteUtils'
import { loadPublicQuotePreferences } from '../../features/settings/settingsService'

const navItems = [
  { to: '/app', label: '대시보드', end: true },
  { to: '/app/sales', label: '판매' },
  { to: '/app/inventory', label: '재고' },
  { to: '/app/customers', label: '고객 / 차량' },
  { to: '/app/imports', label: '초기 가져오기' },
  { to: '/app/settings', label: '설정' },
]

export function AppShell() {
  const desktopApp = isDesktopApp()
  const [runtimeState, setRuntimeState] = useState<'loading' | 'ready' | 'error'>(desktopApp ? 'loading' : 'error')
  const [runtimeMessage, setRuntimeMessage] = useState(
    desktopApp
      ? '데스크톱 실행 환경과 로컬 데이터베이스를 준비하는 중입니다.'
      : '이 화면은 데스크톱 매장 프로그램 안에서만 열 수 있습니다.',
  )

  const handleQuotePublishTick = useEffectEvent(async () => {
    try {
      await syncPublicQuoteFeedSilently()
    } catch (error) {
      console.error('Failed to sync public quote feed', error)
    }
  })

  useEffect(() => {
    if (!desktopApp) {
      return
    }

    let active = true

    void (async () => {
      try {
        const result = await ensureRuntimeReady()
        await ensureReferenceData()

        if (!active) {
          return
        }

        setRuntimeState('ready')
        const repairedMessages: string[] = []
        if (result.costSnapshotBackfilledCount > 0) {
          repairedMessages.push(
            `누락된 원가 스냅샷 ${result.costSnapshotBackfilledCount.toLocaleString('ko-KR')}건을 복구했습니다.`,
          )
        }
        if (result.dailyExpenseBackfilledCount > 0) {
          repairedMessages.push(
            `일일 지출내역 ${result.dailyExpenseBackfilledCount.toLocaleString('ko-KR')}건을 판매일보에서 다시 가져왔습니다.`,
          )
        }

        setRuntimeMessage(
          repairedMessages.length > 0 ? `실행 준비가 완료되었습니다. ${repairedMessages.join(' ')}` : '실행 준비가 완료되었습니다.',
        )
      } catch (error) {
        console.error('Failed to initialize runtime data', error)

        if (!active) {
          return
        }

        setRuntimeState('error')
        setRuntimeMessage(
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : '데스크톱 실행 준비 중 알 수 없는 오류가 발생했습니다.',
        )
      }
    })()

    return () => {
      active = false
    }
  }, [desktopApp])

  useEffect(() => {
    if (!desktopApp || runtimeState !== 'ready') {
      return
    }

    let active = true
    let timerId: number | null = null

    void (async () => {
      try {
        const preferences = await loadPublicQuotePreferences()
        if (!active || !preferences.enabled || !preferences.publishEndpoint.trim()) {
          return
        }

        await handleQuotePublishTick()
        timerId = window.setInterval(() => {
          void handleQuotePublishTick()
        }, DEFAULT_PUBLIC_QUOTE_PUBLISH_INTERVAL_MINUTES * 60_000)
      } catch (error) {
        console.error('Failed to start quote publish timer', error)
      }
    })()

    return () => {
      active = false
      if (timerId !== null) {
        window.clearInterval(timerId)
      }
    }
  }, [desktopApp, runtimeState])

  if (runtimeState !== 'ready') {
    return (
      <div className="app-shell app-shell-loading">
        <section className="loading-panel">
          <p className="eyebrow">타이어 매장 관리</p>
          <h1>{runtimeState === 'loading' ? '프로그램을 준비하는 중입니다' : '프로그램을 열 수 없습니다'}</h1>
          <p className="brand-copy">{runtimeMessage}</p>
          <p className="loading-hint">
            {runtimeState === 'loading'
              ? '로컬 데이터베이스, 스키마, 기준 데이터를 확인하고 있습니다.'
              : '견적 사이트는 홈페이지에서, 매장 관리는 데스크톱 프로그램에서 이용해 주세요.'}
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">타이어 매장 관리</p>
          <h1>매장 운영 데스크톱</h1>
              <p className="brand-version">버전 1.5.0</p>
          <p className="brand-copy">
            재고, 판매, 고객, 초기데이터 가져오기, 백업, 공개 견적 관리까지 한 화면 흐름으로 이어서 사용할 수 있습니다.
          </p>
        </div>

        <nav aria-label="데스크톱 앱 메뉴" className="nav-list">
          {navItems.map((item) => (
            <NavLink
              className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
              end={item.end}
              key={item.to}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <section className="sidebar-panel">
          <h2>현재 확인할 항목</h2>
          <ul className="stack-list">
            <li>재고 수량과 품목별 할인율을 최신 상태로 유지합니다.</li>
            <li>외부에 노출해도 되는 품목만 공개 견적 목록에 반영합니다.</li>
            <li>견적 문의 이후 최종 재고와 작업 금액을 매장에서 바로 확정합니다.</li>
          </ul>
        </section>
      </aside>

      <main className="page-area">
        <Outlet />
      </main>
    </div>
  )
}
