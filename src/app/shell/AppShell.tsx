import { useEffect, useEffectEvent, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { getVersion } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ensureRuntimeReady } from '../../lib/desktop'
import { isDesktopApp } from '../../lib/platform'
import { ensureReferenceData } from '../../lib/referenceData'
import { syncPublicQuoteFeedSilently } from '../../features/publicQuote/publicQuotePublishingService'
import { DEFAULT_PUBLIC_QUOTE_PUBLISH_INTERVAL_MINUTES } from '../../features/publicQuote/quoteUtils'
import { loadPublicQuotePreferences } from '../../features/settings/settingsService'
import { runDriveAutoBackup } from '../../lib/backup/driveAutoSync'

const text = {
  dashboard: '\uB300\uC2DC\uBCF4\uB4DC',
  sales: '\uD310\uB9E4',
  inventory: '\uC7AC\uACE0',
  customers: '\uACE0\uAC1D / \uCC28\uB7C9',
  imports: '\uCD08\uAE30 \uAC00\uC838\uC624\uAE30',
  backups: '\uBC31\uC5C5 / \uBCF5\uC6D0',
  dataCenter: '\uB370\uC774\uD130 \uC13C\uD130',
  updates: '\uC5C5\uB370\uC774\uD2B8',
  settings: '\uC124\uC815',
  preparingRuntime: '\uB85C\uCEEC \uC2E4\uD589 \uD658\uACBD\uACFC \uB370\uC774\uD130\uBCA0\uC774\uC2A4\uB97C \uC900\uBE44\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4.',
  desktopOnly: '\uC774 \uD654\uBA74\uC740 \uB370\uC2A4\uD06C\uD1B1 \uC571\uC5D0\uC11C\uB9CC \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
  runtimeReady: '\uC2E4\uD589 \uC900\uBE44\uAC00 \uB05D\uB0AC\uC2B5\uB2C8\uB2E4.',
  runtimeFailed: '\uC2E4\uD589 \uB370\uC774\uD130\uB97C \uC900\uBE44\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.',
  loadingTitle: '\uC571\uC744 \uC900\uBE44\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4',
  errorTitle: '\uC571\uC744 \uC2DC\uC791\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4',
  loadingHint: '\uB85C\uCEEC \uB370\uC774\uD130\uBCA0\uC774\uC2A4\uC640 \uAE30\uC900 \uB370\uC774\uD130\uB97C \uD655\uC778\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4.',
  desktopHint: '\uB9E4\uC7A5 \uAD00\uB9AC\uB294 \uB370\uC2A4\uD06C\uD1B1 \uC571\uC5D0\uC11C \uC9C4\uD589\uD574 \uC8FC\uC138\uC694.',
  brandEyebrow: '\uD0C0\uC774\uC5B4 \uB9E4\uC7A5 \uAD00\uB9AC',
  brandTitle: '\uB9E4\uC7A5 \uC6B4\uC601 \uB370\uC2A4\uD06C\uD1B1',
  version: '\uBC84\uC804',
  brandCopy:
    '\uC7AC\uACE0, \uD310\uB9E4, \uACE0\uAC1D, \uCD08\uAE30\uB370\uC774\uD130 \uAC00\uC838\uC624\uAE30, \uBC31\uC5C5, \uACF5\uAC1C \uACAC\uC801 \uAD00\uB9AC\uAE4C\uC9C0 \uD55C \uD654\uBA74 \uD750\uB984\uC73C\uB85C \uC774\uC5B4\uC11C \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
  desktopMenu: '\uB370\uC2A4\uD06C\uD1B1 \uBA54\uB274',
  checklistTitle: '\uD604\uC7AC \uD655\uC778\uD560 \uD56D\uBAA9',
  checklistInventory: '\uC7AC\uACE0 \uC218\uB7C9\uACFC \uD488\uBAA9\uBCC4 \uD560\uC778\uC728\uC744 \uCD5C\uC2E0 \uC0C1\uD0DC\uB85C \uC720\uC9C0\uD569\uB2C8\uB2E4.',
  checklistQuote: '\uD648\uD398\uC774\uC9C0\uC5D0 \uB178\uCD9C\uD558\uB294 \uD488\uBAA9\uB9CC \uACF5\uAC1C \uACAC\uC801 \uBAA9\uB85D\uC5D0 \uBC18\uC601\uD569\uB2C8\uB2E4.',
  checklistConfirm:
    '\uACAC\uC801 \uBB38\uC758 \uC774\uD6C4 \uCD5C\uC885 \uC7AC\uACE0\uC640 \uC791\uC5C5 \uAE08\uC561\uC740 \uB9E4\uC7A5\uC5D0\uC11C \uBC14\uB85C \uD655\uC815\uD569\uB2C8\uB2E4.',
} as const

const navItems = [
  { to: '/app', label: text.dashboard, end: true },
  { to: '/app/sales', label: text.sales },
  { to: '/app/inventory', label: text.inventory },
  { to: '/app/customers', label: text.customers },
  { to: '/app/imports', label: text.imports },
  { to: '/app/backups', label: text.backups },
  { to: '/app/data-center', label: text.dataCenter },
  { to: '/app/updates', label: text.updates },
  { to: '/app/settings', label: text.settings },
]

export function AppShell() {
  const desktopApp = isDesktopApp()
  const [runtimeState, setRuntimeState] = useState<'loading' | 'ready' | 'error'>(desktopApp ? 'loading' : 'error')
  const [appVersion, setAppVersion] = useState('2.0.4')
  const [runtimeMessage, setRuntimeMessage] = useState<string>(desktopApp ? text.preparingRuntime : text.desktopOnly)

  const handleQuotePublishTick = useEffectEvent(async () => {
    try {
      await syncPublicQuoteFeedSilently()
    } catch (error) {
      console.error('Failed to sync public quote feed', error)
    }
  })

  useEffect(() => {
    if (!desktopApp) return
    let active = true
    void getVersion()
      .then((version) => {
        if (active) setAppVersion(version)
      })
      .catch(() => {
        if (active) setAppVersion('2.0.4')
      })
    return () => {
      active = false
    }
  }, [desktopApp])

  useEffect(() => {
    if (!desktopApp) return
    let active = true
    void (async () => {
      try {
        const result = await ensureRuntimeReady()
        await ensureReferenceData()
        if (!active) return
        setRuntimeState('ready')
        const repairedMessages: string[] = []
        if (result.costSnapshotBackfilledCount > 0) {
          repairedMessages.push(
            `\uC6D0\uAC00 \uAE30\uB85D ${result.costSnapshotBackfilledCount.toLocaleString('ko-KR')}\uAC74\uC744 \uBCF5\uAD6C\uD588\uC2B5\uB2C8\uB2E4.`,
          )
        }
        if (result.dailyExpenseBackfilledCount > 0) {
          repairedMessages.push(
            `\uC77C\uBCC4 \uC9C0\uCD9C ${result.dailyExpenseBackfilledCount.toLocaleString('ko-KR')}\uAC74\uC744 \uC7AC\uC815\uB9AC\uD588\uC2B5\uB2C8\uB2E4.`,
          )
        }
        setRuntimeMessage(repairedMessages.length > 0 ? `${text.runtimeReady} ${repairedMessages.join(' ')}` : text.runtimeReady)
      } catch (error) {
        console.error('Failed to initialize runtime data', error)
        if (!active) return
        setRuntimeState('error')
        setRuntimeMessage(error instanceof Error ? error.message : typeof error === 'string' ? error : text.runtimeFailed)
      }
    })()
    return () => {
      active = false
    }
  }, [desktopApp])

  useEffect(() => {
    if (!desktopApp || runtimeState !== 'ready') return
    let active = true
    let timerId: number | null = null
    void (async () => {
      try {
        const preferences = await loadPublicQuotePreferences()
        if (!active || !preferences.enabled || !preferences.publishEndpoint.trim()) return
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
      if (timerId !== null) window.clearInterval(timerId)
    }
  }, [desktopApp, runtimeState])

  useEffect(() => {
    if (!desktopApp || runtimeState !== 'ready') return
    void runDriveAutoBackup('startup').catch((error) => {
      console.error('Failed to run Google Drive startup backup', error)
    })
  }, [desktopApp, runtimeState])

  useEffect(() => {
    if (!desktopApp || runtimeState !== 'ready') return
    let unlisten: (() => void) | null = null
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault()
        try {
          await runDriveAutoBackup('exit')
        } catch (error) {
          console.error('Failed to run Google Drive exit backup', error)
        } finally {
          await getCurrentWindow().destroy()
        }
      })
      .then((dispose) => {
        unlisten = dispose
      })
      .catch((error) => {
        console.error('Failed to bind close backup handler', error)
      })
    return () => {
      unlisten?.()
    }
  }, [desktopApp, runtimeState])

  if (runtimeState !== 'ready') {
    return (
      <div className="app-shell app-shell-loading">
        <section className="loading-panel">
          <p className="eyebrow">Tire Store</p>
          <h1>{runtimeState === 'loading' ? text.loadingTitle : text.errorTitle}</h1>
          <p className="brand-copy">{runtimeMessage}</p>
          <p className="loading-hint">{runtimeState === 'loading' ? text.loadingHint : text.desktopHint}</p>
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">{text.brandEyebrow}</p>
          <h1>{text.brandTitle}</h1>
          <p className="brand-version">
            {text.version} {formatDisplayVersion(appVersion)}
          </p>
          <p className="brand-copy">{text.brandCopy}</p>
        </div>

        <nav aria-label={text.desktopMenu} className="nav-list">
          {navItems.map((item) => (
            <NavLink className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`} end={item.end} key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <section className="sidebar-panel">
          <h2>{text.checklistTitle}</h2>
          <ul className="stack-list">
            <li>{text.checklistInventory}</li>
            <li>{text.checklistQuote}</li>
            <li>{text.checklistConfirm}</li>
          </ul>
        </section>
      </aside>

      <main className="page-area">
        <Outlet />
      </main>
    </div>
  )
}

function formatDisplayVersion(version: string) {
  return version.replace(/\.0$/, '')
}
