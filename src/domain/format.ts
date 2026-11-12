import { getBrowserAudioFormat, isBrowserOutputFormat } from './audio-formats'
import type { ExportFormat, ExportRequest, StableOutputFormat } from './model'

export const getExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return ''
  }

  return fileName.slice(lastDot + 1).toLowerCase()
}

export const normalizeFormat = (input: string): string =>
  input.trim().replace(/^\.+/, '').toLowerCase()

export const isSafeExtension = (value: string): boolean =>
  /^[a-z0-9][a-z0-9._-]{0,31}$/.test(value)

export const getResolvedFormat = (format: ExportFormat): StableOutputFormat | null =>
  isStableFormat(format) ? format : null

/**
 * Returns the browser output extension selected by the user. AAC is emitted
 * as raw ADTS AAC rather than being renamed to an M4A container.
 */
export const getRequestedOutputExtension = (
  request: Pick<ExportRequest, 'format'>,
  sourceName: string,
): string | null => {
  if (request.format === 'original') return getExtension(sourceName) || null
  return getBrowserAudioFormat(request.format).outputExtension
}

export const formatOutputFileName = (baseName: string, extension: string): string => {
  const normalizedBase = baseName
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')

  return `${normalizedBase || 'MINFO export'}.${isSafeExtension(extension) ? extension : 'audio'}`
}

export const defaultOutputBaseName = (sourceName: string): string => {
  const lastDot = sourceName.lastIndexOf('.')
  const stem = lastDot > 0 ? sourceName.slice(0, lastDot) : sourceName
  return `${stem} (MINFO)`
}

export const isStableFormat = (format: string): format is StableOutputFormat =>
  isBrowserOutputFormat(format)
