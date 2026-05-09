import { inflateRawSync } from 'node:zlib'

const maxInstallerBytes = 250 * 1024 * 1024
const maxSignatureBytes = 64 * 1024

export function extractUpdateReleaseFromZip(zipBuffer) {
  const entries = readZipEntries(zipBuffer)
  const installer = pickInstaller(entries)
  if (!installer) {
    throw new Error('zip 안에서 업데이트 설치 파일(.exe 또는 .msi)을 찾지 못했습니다.')
  }

  const installerName = zipBaseName(installer.name)
  const signatureEntry = pickSignature(entries, installerName)
  if (!signatureEntry) {
    throw new Error('zip 안에서 설치 파일에 대응되는 .sig 서명 파일을 찾지 못했습니다.')
  }

  const signature = signatureEntry.data.toString('utf8').trim()
  if (!signature) {
    throw new Error('zip 안의 .sig 서명 파일이 비어 있습니다.')
  }

  return {
    fileName: safeUpdateFileName(installerName),
    fileBytes: installer.data,
    signature,
    version: extractVersionFromFileName(installerName),
  }
}

export function extractVersionFromFileName(fileName) {
  const baseName = zipBaseName(fileName)
  const match = baseName.match(/(?:^|[_\-\s])v?(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)(?:[_\-\s.]|$)/)
  return match?.[1] ?? null
}

function readZipEntries(zipBuffer) {
  const centralDirectory = findCentralDirectory(zipBuffer)
  const entries = []
  let offset = centralDirectory.offset

  for (let index = 0; index < centralDirectory.totalEntries; index += 1) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('zip 중앙 디렉터리 형식이 올바르지 않습니다.')
    }

    const compression = zipBuffer.readUInt16LE(offset + 10)
    const compressedSize = zipBuffer.readUInt32LE(offset + 20)
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24)
    const fileNameLength = zipBuffer.readUInt16LE(offset + 28)
    const extraLength = zipBuffer.readUInt16LE(offset + 30)
    const commentLength = zipBuffer.readUInt16LE(offset + 32)
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42)
    const name = zipBuffer.toString('utf8', offset + 46, offset + 46 + fileNameLength)
    offset += 46 + fileNameLength + extraLength + commentLength

    if (!name || name.endsWith('/') || name.endsWith('\\')) continue
    if (!isCandidateEntry(name)) continue
    assertCandidateSize(name, uncompressedSize)

    const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize)
    entries.push({
      name,
      data: decompressEntry(compressed, compression),
    })
  }

  return entries
}

function findCentralDirectory(zipBuffer) {
  const minOffset = Math.max(0, zipBuffer.length - 0xffff - 22)
  for (let offset = zipBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === 0x06054b50) {
      return {
        totalEntries: zipBuffer.readUInt16LE(offset + 10),
        offset: zipBuffer.readUInt32LE(offset + 16),
      }
    }
  }
  throw new Error('zip 파일의 끝 정보를 찾지 못했습니다.')
}

function decompressEntry(compressed, compression) {
  if (compression === 0) return Buffer.from(compressed)
  if (compression === 8) return inflateRawSync(compressed)
  throw new Error(`지원하지 않는 zip 압축 방식입니다: ${compression}`)
}

function pickInstaller(entries) {
  return entries
    .filter((entry) => {
      const name = entry.name.replace(/\\/g, '/').toLowerCase()
      const baseName = zipBaseName(name)
      return !name.includes('/server-hotfix/') && (baseName.endsWith('.exe') || baseName.endsWith('.msi'))
    })
    .sort((left, right) => installerScore(right.name) - installerScore(left.name))[0]
}

function isCandidateEntry(name) {
  const normalized = name.replace(/\\/g, '/').toLowerCase()
  if (normalized.includes('/server-hotfix/')) return false
  const baseName = zipBaseName(normalized)
  return baseName.endsWith('.exe') || baseName.endsWith('.msi') || baseName.endsWith('.sig')
}

function assertCandidateSize(name, uncompressedSize) {
  const baseName = zipBaseName(name).toLowerCase()
  if (baseName.endsWith('.sig') && uncompressedSize > maxSignatureBytes) {
    throw new Error(`zip 안의 서명 파일이 너무 큽니다: ${zipBaseName(name)}`)
  }
  if ((baseName.endsWith('.exe') || baseName.endsWith('.msi')) && uncompressedSize > maxInstallerBytes) {
    throw new Error(`zip 안의 설치 파일이 너무 큽니다: ${zipBaseName(name)}`)
  }
}

function pickSignature(entries, installerName) {
  const expected = `${installerName}.sig`.toLowerCase()
  const signatures = entries.filter((entry) => {
    const name = entry.name.replace(/\\/g, '/').toLowerCase()
    return !name.includes('/server-hotfix/') && zipBaseName(name).endsWith('.sig')
  })
  const exact = signatures.find((entry) => zipBaseName(entry.name).toLowerCase() === expected)
  if (exact) return exact
  if (signatures.length === 1) return signatures[0]
  if (signatures.length > 1) {
    throw new Error('zip 안에 .sig 파일이 여러 개 있습니다. 설치 파일과 같은 이름의 .sig 파일을 넣어 주세요.')
  }
  return undefined
}

function installerScore(name) {
  const baseName = zipBaseName(name)
  let score = 0
  if (/^Tire[_\s-]?Store[_\s-]?\d+\.\d+\.\d+.*setup\.exe$/i.test(baseName)) score += 100
  if (/setup/i.test(baseName)) score += 20
  if (/^[\x20-\x7e]+$/.test(baseName)) score += 10
  if (!/\s/.test(baseName)) score += 5
  return score
}

function safeUpdateFileName(fileName) {
  const baseName = zipBaseName(fileName)
  if (/^[A-Za-z0-9._-]+$/.test(baseName)) return baseName
  const extension = baseName.toLowerCase().endsWith('.msi') ? '.msi' : '.exe'
  const nameWithoutExtension = baseName.replace(/\.[^.]+$/, '')
  const asciiName = nameWithoutExtension
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${asciiName || 'Tire_Store_update'}${extension}`
}

function zipBaseName(value) {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? value
}
