import type { DatabaseBackupPayload } from '../types'

export type EncryptedDriveBackupPackage = {
  format: 'tire-store-encrypted-backup'
  version: 1
  exportedAt: string
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  data: string
}

const iterations = 120_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function deriveKey(password: string, salt: Uint8Array) {
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBackupPayload(payload: DatabaseBackupPayload, password: string): Promise<EncryptedDriveBackupPackage> {
  if (!password.trim()) {
    throw new Error('백업 암호를 입력하세요.')
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, key, encoder.encode(JSON.stringify(payload)))
  return {
    format: 'tire-store-encrypted-backup',
    version: 1,
    exportedAt: payload.exportedAt,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  }
}

export async function decryptBackupPackage(pack: EncryptedDriveBackupPackage, password: string): Promise<DatabaseBackupPayload> {
  if (pack.format !== 'tire-store-encrypted-backup' || pack.version !== 1) {
    throw new Error('Tire Store 백업 파일이 아닙니다.')
  }
  const key = await deriveKey(password, base64ToBytes(pack.salt))
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(pack.iv).buffer as ArrayBuffer }, key, base64ToBytes(pack.data))
  return JSON.parse(decoder.decode(decrypted)) as DatabaseBackupPayload
}
