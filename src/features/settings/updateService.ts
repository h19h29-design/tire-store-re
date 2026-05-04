import type { DownloadEvent } from '@tauri-apps/plugin-updater'

export type TauriUpdaterStatus = {
  supported: boolean
  updateAvailable: boolean
  currentVersion: string
  version: string
  date?: string
  body?: string
  message: string
  rawJson?: Record<string, unknown>
}

export type TauriUpdaterProgress = {
  downloadedBytes: number
  totalBytes: number | null
  percent: number | null
}

export function isTauriRuntime() {
  return '__TAURI_INTERNALS__' in window
}

export async function checkTauriUpdater(): Promise<TauriUpdaterStatus> {
  if (!isTauriRuntime()) {
    return {
      supported: false,
      updateAvailable: false,
      currentVersion: '',
      version: '',
      message: '브라우저 미리보기에서는 자동 업데이트를 사용할 수 없습니다.',
    }
  }

  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) {
      return {
        supported: true,
        updateAvailable: false,
        currentVersion: '',
        version: '',
        message: '현재 최신 버전입니다.',
      }
    }

    return {
      supported: true,
      updateAvailable: true,
      currentVersion: update.currentVersion,
      version: update.version,
      date: update.date,
      body: update.body,
      rawJson: update.rawJson,
      message: `새 버전 ${update.version}을 설치할 수 있습니다.`,
    }
  } catch (error) {
    return {
      supported: true,
      updateAvailable: false,
      currentVersion: '',
      version: '',
      message: error instanceof Error ? error.message : '자동 업데이트 확인에 실패했습니다.',
    }
  }
}

export async function downloadInstallAndRelaunch(onProgress?: (progress: TauriUpdaterProgress) => void) {
  const { check } = await import('@tauri-apps/plugin-updater')
  const { relaunch } = await import('@tauri-apps/plugin-process')
  const update = await check()
  if (!update) {
    throw new Error('설치할 업데이트가 없습니다.')
  }

  let downloadedBytes = 0
  let totalBytes: number | null = null
  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === 'Started') {
      downloadedBytes = 0
      totalBytes = event.data.contentLength ?? null
    } else if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength
    }
    onProgress?.({
      downloadedBytes,
      totalBytes,
      percent: totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null,
    })
  })

  await relaunch()
}
