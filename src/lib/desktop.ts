import { invoke } from '@tauri-apps/api/core'
import type {
  BackupResult,
  DatabaseBackupPayload,
  ImportFileHints,
  InitialImportResult,
  ParsedInventoryWorkbook,
  ParsedSalesWorkbook,
  ParsedVendorPriceWorkbook,
  RuntimeInfo,
  RuntimeReadyResult,
  VendorPriceImportResult,
} from './types'

let runtimeReadyPromise: Promise<RuntimeReadyResult> | null = null

function invokeEnsureRuntimeReady() {
  return invoke<RuntimeReadyResult>('ensure_runtime_ready')
}

export function getRuntimeInfo() {
  return invoke<RuntimeInfo>('get_runtime_info')
}

export function detectImportFiles() {
  return invoke<ImportFileHints>('detect_import_files')
}

export function ensureRuntimeReady(options: { force?: boolean } = {}) {
  if (!runtimeReadyPromise || options.force) {
    runtimeReadyPromise = invokeEnsureRuntimeReady().catch((error) => {
      runtimeReadyPromise = null
      throw error
    })
  }

  return runtimeReadyPromise
}

export function refreshRuntimeReady() {
  return ensureRuntimeReady({ force: true })
}

export function createBackup() {
  return invoke<BackupResult>('create_backup')
}

export function createBackupAt(destinationPath: string) {
  return invoke<BackupResult>('create_backup_at', { destinationPath })
}

export function exportDatabaseBackupPayload() {
  return invoke<DatabaseBackupPayload>('export_database_backup_payload')
}

export function restoreDatabaseFromBase64(databaseBase64: string) {
  return invoke<BackupResult>('restore_database_from_base64', { databaseBase64 })
}

export function restoreDatabaseFromPath(sourcePath: string) {
  return invoke<BackupResult>('restore_database_from_path', { sourcePath })
}

export function savePlatformSecret(platformCode: string, secret: string) {
  return invoke<void>('save_platform_secret', { platformCode, secret })
}

export function getPlatformSecret(platformCode: string) {
  return invoke<string | null>('get_platform_secret', { platformCode })
}

export function deletePlatformSecret(platformCode: string) {
  return invoke<void>('delete_platform_secret', { platformCode })
}

export function hasPlatformSecret(platformCode: string) {
  return invoke<boolean>('has_platform_secret', { platformCode })
}

export function parseInventoryWorkbook(path: string) {
  return invoke<ParsedInventoryWorkbook>('parse_inventory_workbook', { path })
}

export function parseSalesWorkbook(path: string) {
  return invoke<ParsedSalesWorkbook>('parse_sales_workbook', { path })
}

export function importInitialData(inventoryPath: string, salesPath: string) {
  return invoke<InitialImportResult>('import_initial_data', {
    inventoryPath,
    salesPath,
  })
}

export function parseVendorPriceWorkbook(path: string) {
  return invoke<ParsedVendorPriceWorkbook>('parse_vendor_price_workbook', { path })
}

export function applyVendorPriceWorkbook(path: string) {
  return invoke<VendorPriceImportResult>('apply_vendor_price_workbook', { path })
}
