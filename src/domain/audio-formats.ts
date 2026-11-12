/**
 * Browser-export format catalogue.
 *
 * This is the single source for browser-visible output formats and their
 * user-facing container facts. Adding an entry here does not by itself make
 * media processing available: the export planner, FFmpeg arguments, output
 * probe, and regression samples still need to support it.
 */
export const browserOutputFormatIds = ['mp3', 'm4a', 'aac'] as const

export type BrowserOutputFormat = (typeof browserOutputFormatIds)[number]

export interface BrowserAudioFormatDefinition {
  readonly id: BrowserOutputFormat
  readonly label: string
  readonly selectorLabel: string
  readonly outputExtension: string
  readonly containerDescription: string
  readonly mimeType: string
}

export const browserAudioFormats = {
  mp3: {
    id: 'mp3',
    label: 'MP3',
    selectorLabel: 'MP3',
    outputExtension: 'mp3',
    containerDescription: 'MP3',
    mimeType: 'audio/mpeg',
  },
  m4a: {
    id: 'm4a',
    label: 'M4A',
    selectorLabel: 'M4A',
    outputExtension: 'm4a',
    containerDescription: 'MP4 音频容器',
    mimeType: 'audio/mp4',
  },
  aac: {
    id: 'aac',
    label: 'AAC',
    selectorLabel: 'AAC（ADTS .aac）',
    outputExtension: 'aac',
    containerDescription: 'ADTS AAC',
    mimeType: 'audio/aac',
  },
} as const satisfies Readonly<Record<BrowserOutputFormat, BrowserAudioFormatDefinition>>

export const browserAudioFormatList = browserOutputFormatIds.map(
  (format) => browserAudioFormats[format],
)

export interface BrowserExportFormatOption {
  readonly id: 'original' | BrowserOutputFormat
  readonly label: string
}

export const browserExportFormatOptions: readonly BrowserExportFormatOption[] = [
  { id: 'original', label: '保持原文件格式' },
  ...browserAudioFormatList.map((format) => ({
    id: format.id,
    label: format.selectorLabel,
  })),
]

/** Browser fallback used by capability failures and incompatible field sets. */
export const browserFallbackFormatId = 'mp3' as const satisfies BrowserOutputFormat
export const browserFallbackFormat = browserAudioFormats[browserFallbackFormatId]

/**
 * Formats offered only to the local FFmpeg script path. They deliberately do
 * not imply browser runtime support or an editable-field capability contract.
 */
export const localFfmpegOnlyFormatIds = [
  'flac',
  'wav',
  'ogg',
  'wma',
  'ape',
  'amr',
  'mid',
  'alac',
  'oga',
] as const

export type LocalFfmpegOnlyFormat = (typeof localFfmpegOnlyFormatIds)[number]
export type LocalFfmpegFormat = BrowserOutputFormat | LocalFfmpegOnlyFormat
export type LocalFfmpegFormatOptionId = 'use-plan' | LocalFfmpegFormat | 'custom'

const localFfmpegOnlyFormatLabels: Readonly<Record<LocalFfmpegOnlyFormat, string>> = {
  flac: 'FLAC',
  wav: 'WAV',
  ogg: 'OGG',
  wma: 'WMA',
  ape: 'APE',
  amr: 'AMR',
  mid: 'MID',
  alac: 'ALAC',
  oga: 'OGA',
}

export interface LocalFfmpegFormatOption {
  readonly id: LocalFfmpegFormatOptionId
  readonly label: string
}

export const localFfmpegFormatOptions: readonly LocalFfmpegFormatOption[] = [
  { id: 'use-plan', label: '跟随浏览器预检' },
  ...browserAudioFormatList.map((format) => ({ id: format.id, label: format.label })),
  ...localFfmpegOnlyFormatIds.map((format) => ({
    id: format,
    label: localFfmpegOnlyFormatLabels[format],
  })),
  { id: 'custom', label: '手动输入' },
]

export const getBrowserAudioFormat = (
  format: BrowserOutputFormat,
): BrowserAudioFormatDefinition => browserAudioFormats[format]

export const isBrowserOutputFormat = (format: string): format is BrowserOutputFormat =>
  browserOutputFormatIds.some((candidate) => candidate === format)
