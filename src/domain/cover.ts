import type { CoverArtwork } from './model'

const maximumCoverBytes = 2_000_000
const maximumCoverDimension = 1_000

export const supportedCoverMimes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

const normalizeDeclaredMime = (mime: string): string =>
  mime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mime.toLowerCase()

export interface CoverValidationResult {
  readonly ok: boolean
  readonly error?: string
  readonly cover?: CoverArtwork
}

export interface CoverImageInfo {
  readonly mime: string
  readonly width: number
  readonly height: number
}

const viewAt = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const matches = (bytes: Uint8Array, values: readonly number[], offset = 0): boolean =>
  values.every((value, index) => bytes[offset + index] === value)

const readPng = (bytes: Uint8Array): CoverImageInfo | null => {
  if (
    bytes.byteLength < 24 ||
    !matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    !matches(bytes, [0x49, 0x48, 0x44, 0x52], 12)
  ) {
    return null
  }

  const view = viewAt(bytes)
  return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) }
}

const readGif = (bytes: Uint8Array): CoverImageInfo | null => {
  if (
    bytes.byteLength < 10 ||
    (!matches(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) &&
      !matches(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
  ) {
    return null
  }

  const view = viewAt(bytes)
  return { mime: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) }
}

const readJpeg = (bytes: Uint8Array): CoverImageInfo | null => {
  if (bytes.byteLength < 4 || !matches(bytes, [0xff, 0xd8])) {
    return null
  }

  const view = viewAt(bytes)
  let offset = 2
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (bytes[offset] === 0xff) {
      offset += 1
    }

    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break
    if (offset + 1 >= bytes.byteLength) break

    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.byteLength) break
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame && length >= 7) {
      return {
        mime: 'image/jpeg',
        height: view.getUint16(offset + 3),
        width: view.getUint16(offset + 5),
      }
    }

    offset += length
  }

  return null
}

const readWebp = (bytes: Uint8Array): CoverImageInfo | null => {
  if (
    bytes.byteLength < 30 ||
    !matches(bytes, [0x52, 0x49, 0x46, 0x46]) ||
    !matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return null
  }

  const view = viewAt(bytes)
  const chunk = String.fromCharCode(...bytes.slice(12, 16))
  if (chunk === 'VP8X') {
    return {
      mime: 'image/webp',
      width: 1 + view.getUint8(24) + (view.getUint8(25) << 8) + (view.getUint8(26) << 16),
      height: 1 + view.getUint8(27) + (view.getUint8(28) << 8) + (view.getUint8(29) << 16),
    }
  }

  if (chunk === 'VP8L' && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
    const bits =
      (bytes[21] ?? 0) +
      ((bytes[22] ?? 0) << 8) +
      ((bytes[23] ?? 0) << 16) +
      (((bytes[24] ?? 0) & 0x3f) << 24)
    return {
      mime: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }

  if (chunk === 'VP8 ' && bytes.byteLength >= 30 && matches(bytes, [0x9d, 0x01, 0x2a], 23)) {
    return {
      mime: 'image/webp',
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    }
  }

  return null
}

export const inspectCoverHeader = (bytes: Uint8Array): CoverImageInfo | null =>
  readPng(bytes) ?? readGif(bytes) ?? readJpeg(bytes) ?? readWebp(bytes)

const verifyBrowserDecoding = async (file: File): Promise<void> => {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file)
    bitmap.close()
    return
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

const randomId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `cover-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const validateCover = async (
  file: File,
  kind: CoverArtwork['kind'] = 'front',
): Promise<CoverValidationResult> => {
  if (file.size > maximumCoverBytes) {
    return {
      ok: false,
      error: `封面大小为 ${(file.size / 1_000_000).toFixed(2)} MB，不能超过 2 MB。`,
    }
  }

  try {
    const header = new Uint8Array(await file.slice(0, 524_288).arrayBuffer())
    const image = inspectCoverHeader(header)
    if (!image || !supportedCoverMimes.has(image.mime)) {
      return { ok: false, error: '封面必须是有效的 PNG、JPG/JPEG、GIF 或 WebP 文件。' }
    }

    if (file.type && normalizeDeclaredMime(file.type) !== image.mime) {
      return {
        ok: false,
        error: `文件声明为 ${file.type}，但图片内容实际是 ${image.mime}。请重新导出或选择正确文件。`,
      }
    }

    if (image.width > maximumCoverDimension || image.height > maximumCoverDimension) {
      return {
        ok: false,
        error: `封面尺寸为 ${image.width}×${image.height} px，宽和高均不能超过 1000 px。`,
      }
    }

    await verifyBrowserDecoding(file)
    return {
      ok: true,
      cover: {
        id: randomId(),
        kind,
        mime: image.mime,
        size: file.size,
        width: image.width,
        height: image.height,
        source: 'replacement',
        previewUrl: URL.createObjectURL(file),
        file,
      },
    }
  } catch {
    return { ok: false, error: '无法读取封面图像，请选择未损坏的图片。' }
  }
}
