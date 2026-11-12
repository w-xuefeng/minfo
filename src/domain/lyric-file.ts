import { getExtension } from './format'
import { parseLyricsPreview } from './lrc'
import type { LyricsSlot } from './model'

export const maximumLyricsFileBytes = 2_000_000

export const lyricsFileAccept = '.txt,.lrc,.qrc,text/plain,application/xml,text/xml'

export type LyricsFileFormat = 'text' | 'lrc' | 'qrc'

export const lyricsFileFormatLabel = (format: LyricsFileFormat): string => {
  switch (format) {
    case 'text':
      return '文本歌词'
    case 'lrc':
      return 'LRC 歌词'
    case 'qrc':
      return 'QRC 歌词'
  }
}

export interface LyricsFileParseSuccess {
  readonly ok: true
  readonly format: LyricsFileFormat
  readonly text: string
  readonly representation: LyricsSlot['representation']
  /** A user-visible description of a successful conversion, if one occurred. */
  readonly notice: string
}

export interface LyricsFileParseFailure {
  readonly ok: false
  readonly error: string
}

export type LyricsFileParseResult = LyricsFileParseSuccess | LyricsFileParseFailure

const supportedExtensions = new Set(['txt', 'lrc', 'qrc'])
const qrcLineTimestamp = /^\s*\[(\d+),(\d+)\](.*)$/u
const qrcWordTimestamp = /\(\d+,\d+\)/gu

const hasInvalidTextControlCharacter = (text: string): boolean => {
  for (const character of text) {
    const code = character.charCodeAt(0)
    if ((code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) {
      return true
    }
  }
  return false
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((byte, index) => bytes[index] === byte)

const decodeText = (bytes: Uint8Array): string => {
  if (startsWith(bytes, [0xff, 0xfe])) {
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))
  }
  if (startsWith(bytes, [0xfe, 0xff])) {
    return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2))
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

const textRepresentation = (text: string): LyricsSlot['representation'] =>
  parseLyricsPreview(text).mode === 'plain' ? 'plain' : 'synchronised'

const lrcTimestamp = (milliseconds: number): string => {
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const remainder = milliseconds % 1_000
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    remainder,
  ).padStart(3, '0')}]`
}

interface QrcExtraction {
  readonly ok: boolean
  readonly text?: string
  readonly error?: string
}

const extractQrcXmlContent = (source: string): QrcExtraction => {
  const trimmed = source.trimStart()
  if (!trimmed.startsWith('<')) return { ok: true, text: source }

  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (
    document.documentElement.localName.toLowerCase() === 'parsererror' ||
    document.getElementsByTagName('parsererror').length > 0
  ) {
    return { ok: false, error: 'QRC XML 格式不完整，无法读取 LyricContent。' }
  }

  for (const element of Array.from(document.getElementsByTagName('*'))) {
    const attribute =
      element.getAttribute('LyricContent') ?? element.getAttribute('lyriccontent')
    if (attribute?.trim()) return { ok: true, text: attribute }
    if (element.localName.toLowerCase() === 'lyriccontent' && element.textContent?.trim()) {
      return { ok: true, text: element.textContent }
    }
  }

  return { ok: false, error: 'QRC XML 中没有可读取的 LyricContent。' }
}

const parseQrc = (source: string): LyricsFileParseResult => {
  const extracted = extractQrcXmlContent(source)
  if (!extracted.ok || !extracted.text) {
    return {
      ok: false,
      error: extracted.error ?? '无法从 QRC 文件读取歌词。',
    }
  }

  const qrc = extracted.text.replace(/\r\n?/g, '\n')
  const convertedLines: string[] = []
  let convertedLineCount = 0

  for (const line of qrc.split('\n')) {
    const match = qrcLineTimestamp.exec(line)
    if (!match) {
      convertedLines.push(line)
      continue
    }

    const [, rawStart, rawDuration, lyric] = match
    const start = Number(rawStart)
    const duration = Number(rawDuration)
    if (
      !Number.isSafeInteger(start) ||
      start < 0 ||
      !Number.isSafeInteger(duration) ||
      duration < 0
    ) {
      return { ok: false, error: 'QRC 中包含无效的毫秒时间标签。' }
    }
    convertedLines.push(`${lrcTimestamp(start)}${(lyric ?? '').replace(qrcWordTimestamp, '')}`)
    convertedLineCount += 1
  }

  const converted = convertedLines.join('\n')
  if (convertedLineCount > 0 && converted.trim()) {
    return {
      ok: true,
      format: 'qrc',
      text: converted,
      representation: 'synchronised',
      notice: '已解析明文 QRC，并将逐字时间转换为 LRC 行级时间。',
    }
  }

  if (parseLyricsPreview(qrc).mode !== 'plain') {
    return {
      ok: true,
      format: 'qrc',
      text: qrc,
      representation: 'synchronised',
      notice: '该 QRC 包含兼容的 LRC 内容，已按原文导入。',
    }
  }

  return {
    ok: false,
    error:
      '无法解析 QRC。仅支持明文 QRC 或包含 LyricContent 的 XML QRC；请先导出为明文 LRC/QRC。',
  }
}

/**
 * Reads only a user-selected lyrics file. It never uploads or persists the
 * file, and returns user-safe errors instead of leaking decoder failures.
 */
export const parseLyricsFile = async (file: File): Promise<LyricsFileParseResult> => {
  const extension = getExtension(file.name)
  if (!supportedExtensions.has(extension)) {
    return { ok: false, error: '仅支持 .txt、.lrc 或 .qrc 歌词文件。' }
  }
  if (file.size === 0) {
    return { ok: false, error: '歌词文件为空，请选择包含歌词内容的文件。' }
  }
  if (file.size > maximumLyricsFileBytes) {
    return {
      ok: false,
      error: `歌词文件大小为 ${(file.size / 1_000_000).toFixed(2)} MB，不能超过 2 MB。`,
    }
  }

  let text: string
  try {
    text = decodeText(new Uint8Array(await file.arrayBuffer())).replace(/^\uFEFF/u, '')
  } catch {
    return { ok: false, error: '无法按 UTF-8 或带 BOM 的 UTF-16 读取歌词文件。' }
  }

  if (!text.trim()) {
    return { ok: false, error: '歌词文件不包含可导入的文本。' }
  }
  if (hasInvalidTextControlCharacter(text)) {
    return { ok: false, error: '歌词文件包含不能作为文本导入的控制字符。' }
  }

  if (extension === 'qrc') return parseQrc(text)

  const format: LyricsFileFormat = extension === 'lrc' ? 'lrc' : 'text'
  return {
    ok: true,
    format,
    text,
    representation: textRepresentation(text),
    notice: format === 'lrc' ? '已解析 LRC 歌词文件。' : '已解析文本歌词文件。',
  }
}
