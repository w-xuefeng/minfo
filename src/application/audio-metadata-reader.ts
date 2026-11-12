import { parseBlob } from 'music-metadata'
import type { IAudioMetadata, ILyricsTag, IPicture } from 'music-metadata'

import { getExtension } from '@/domain/format'
import {
  canonicalizeLyricsTextForComparison,
  defaultLyricsLanguage,
  isLyricsLanguage,
  normalizeLyricsLanguage,
} from '@/domain/lyrics'
import { emptyDraft } from '@/domain/model'
import type {
  CoverArtwork,
  EditableTag,
  FileIdentity,
  InspectionResult,
  LyricsSlot,
  NativeTag,
  TechnicalInfo,
} from '@/domain/model'

const formatMillisecondsAsLrc = (milliseconds: number): string => {
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const remainder = milliseconds % 1_000
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    remainder,
  ).padStart(3, '0')}]`
}

const synchronisedLyricsText = (lyrics: ILyricsTag): string =>
  lyrics.syncText
    .map((item) =>
      typeof item.timestamp === 'number'
        ? `${formatMillisecondsAsLrc(item.timestamp)}${item.text}`
        : item.text,
    )
    .join('\n')

const lrcTimestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/

const lyricsTextFingerprint = (value: string): string =>
  canonicalizeLyricsTextForComparison(value)
    .split('\n')
    .map((line) => line.trim().replace(/(\[\d+\])\s+/g, '$1'))
    .join('\n')
    .trim()

const hasLrcTimestamp = (value: string): boolean => lrcTimestampPattern.test(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface NativeLyricsValue {
  readonly text: string
  readonly language?: string
  readonly descriptor?: string
  readonly representation: LyricsSlot['representation']
}

interface NativeLyricsTag {
  readonly type: string
  readonly id: string
  readonly value: unknown
}

interface NativeLyricsTagKind {
  readonly language?: string
  readonly representation: LyricsSlot['representation']
}

const nativeTagNameVariants = (id: string): readonly string[] => {
  const normalized = id.trim().toLowerCase()
  const withoutId3UserTextPrefix = normalized.replace(/^tx{2,3}:/, '')
  const variants = new Set<string>([normalized, withoutId3UserTextPrefix])
  for (const value of [...variants]) {
    const colonIndex = value.lastIndexOf(':')
    if (colonIndex >= 0) variants.add(value.slice(colonIndex + 1))
    const slashIndex = value.lastIndexOf('/')
    if (slashIndex >= 0) variants.add(value.slice(slashIndex + 1))
  }
  return [...variants].filter(Boolean)
}

const normalizedNativeTagName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[_.:/\s]+/g, '-')

const isNativeLyricsLanguageTag = (id: string): boolean =>
  nativeTagNameVariants(id).some((name) => {
    const normalized = normalizedNativeTagName(name)
    return (
      /(?:^|-)(?:lyrics?|lyric)-(?:language|lang)$/.test(normalized) ||
      /(?:^|-)(?:language|lang)-(?:lyrics?|lyric)$/.test(normalized) ||
      /(?:^|-)(?:lyrics?|lyric)(?:language|lang)$/.test(normalized) ||
      /(?:^|-)(?:language|lang)(?:lyrics?|lyric)$/.test(normalized)
    )
  })

const nativeLyricsAliases: readonly {
  readonly name: string
  readonly representation: LyricsSlot['representation']
}[] = [
  { name: 'unsynchronized-lyrics', representation: 'plain' },
  { name: 'unsynchronised-lyrics', representation: 'plain' },
  { name: 'synchronized-lyrics', representation: 'synchronised' },
  { name: 'synchronised-lyrics', representation: 'synchronised' },
  { name: 'unsynced-lyrics', representation: 'plain' },
  { name: 'synced-lyrics', representation: 'synchronised' },
  { name: 'unsynchronizedlyrics', representation: 'plain' },
  { name: 'unsynchronisedlyrics', representation: 'plain' },
  { name: 'synchronizedlyrics', representation: 'synchronised' },
  { name: 'synchronisedlyrics', representation: 'synchronised' },
  { name: 'unsyncedlyrics', representation: 'plain' },
  { name: 'syncedlyrics', representation: 'synchronised' },
  { name: 'sylt', representation: 'synchronised' },
  { name: 'uslt', representation: 'plain' },
  { name: 'ult', representation: 'plain' },
  { name: '©lyr', representation: 'plain' },
  { name: 'lyrics', representation: 'plain' },
  { name: 'lyric', representation: 'plain' },
]

const nativeLyricsTagKind = (id: string): NativeLyricsTagKind | null => {
  if (isNativeLyricsLanguageTag(id)) return null

  for (const name of nativeTagNameVariants(id)) {
    const normalized = normalizedNativeTagName(name)
    for (const alias of nativeLyricsAliases) {
      const match = new RegExp(`(?:^|-)${alias.name}(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$`).exec(
        normalized,
      )
      if (match) {
        return {
          ...(match[1] ? { language: match[1] } : {}),
          representation: alias.representation,
        }
      }
    }
  }
  return null
}

export const isManagedLyricsNativeTag = (id: string): boolean =>
  isNativeLyricsLanguageTag(id) || nativeLyricsTagKind(id) !== null

export const isSynchronisedLyricsNativeTag = (id: string): boolean =>
  nativeLyricsTagKind(id)?.representation === 'synchronised'

/**
 * Exact source identifiers that belong exclusively to the lyrics-slot model.
 * They are needed during export so a removed slot cannot survive under a
 * container-specific alias such as `TXXX:lyrics-eng`.
 */
export const managedLyricsNativeTagKeys = (
  nativeTags: readonly NativeTag[],
): readonly string[] => [
  ...new Set(
    nativeTags
      .filter((tag) => isManagedLyricsNativeTag(tag.id))
      .map((tag) => tag.id.trim())
      .filter(Boolean),
  ),
]

const stringValues = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringValues)
  return []
}

const nativeSynchronisedLyricsText = (value: unknown): string => {
  if (!Array.isArray(value)) return ''
  return value
    .flatMap((item) => {
      if (!isRecord(item) || typeof item.text !== 'string') return []
      return typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
        ? [`${formatMillisecondsAsLrc(item.timestamp)}${item.text}`]
        : [item.text]
    })
    .join('\n')
}

const nativeLyricsValues = (value: unknown): readonly NativeLyricsValue[] => {
  if (typeof value === 'string') {
    return [
      {
        text: value,
        representation: hasLrcTimestamp(value) ? 'synchronised' : 'plain',
      },
    ]
  }
  if (Array.isArray(value)) return value.flatMap(nativeLyricsValues)
  if (!isRecord(value)) return []

  const synchronisedText = nativeSynchronisedLyricsText(value.syncText)
  const plainText = typeof value.text === 'string' ? value.text : ''
  const text = synchronisedText || plainText
  if (!text) return []
  return [
    {
      text,
      ...(typeof value.language === 'string' ? { language: value.language } : {}),
      ...(typeof value.descriptor === 'string' ? { descriptor: value.descriptor } : {}),
      representation: synchronisedText || hasLrcTimestamp(text) ? 'synchronised' : 'plain',
    },
  ]
}

const nativeLyricsTags = (
  native: IAudioMetadata['native'] | undefined,
): readonly NativeLyricsTag[] =>
  Object.entries(native ?? {}).flatMap(([type, tags]) =>
    tags.map((tag) => ({ type, id: tag.id, value: tag.value })),
  )

const nativeLyricsLanguageDeclarations = (
  tags: readonly NativeLyricsTag[],
): ReadonlyMap<string, string> => {
  const languageByType = new Map<string, string>()
  for (const tag of tags) {
    if (!isNativeLyricsLanguageTag(tag.id)) continue
    const language = stringValues(tag.value).map(normalizeLyricsLanguage).find(isLyricsLanguage)
    if (language) languageByType.set(tag.type, language)
  }
  return languageByType
}

interface ParsedLyricsSlots {
  readonly slots: readonly LyricsSlot[]
  readonly warnings: readonly string[]
}

type AppendLyricsResult = 'added' | 'merged' | 'duplicate'

export const parseLyricsSlots = (
  lyrics: readonly ILyricsTag[] | undefined,
  native?: IAudioMetadata['native'],
): ParsedLyricsSlots => {
  const slots: LyricsSlot[] = []
  const slotsByLanguage = new Map<string, number>()
  const slotTextFingerprints = new Map<string, Set<string>>()
  const warnings: string[] = []
  const warnedLanguages = new Set<string>()
  const standardTextFingerprints = new Set<string>()
  const tags = nativeLyricsTags(native)
  const languagesByType = nativeLyricsLanguageDeclarations(tags)
  const declaredNativeLanguages = [...new Set(languagesByType.values())]
  const inferredNativeLanguage =
    declaredNativeLanguages.length === 1
      ? (declaredNativeLanguages[0] ?? defaultLyricsLanguage)
      : defaultLyricsLanguage

  const sourceFingerprint = (language: string, text: string): string =>
    `${language}\u0000${lyricsTextFingerprint(text)}`

  const append = (next: LyricsSlot): AppendLyricsResult => {
    const fingerprint = lyricsTextFingerprint(next.text)
    if (!fingerprint) return 'duplicate'
    const existingIndex = slotsByLanguage.get(next.language)
    if (existingIndex === undefined) {
      slotsByLanguage.set(next.language, slots.length)
      slotTextFingerprints.set(next.language, new Set([fingerprint]))
      slots.push(next)
      return 'added'
    }

    const fingerprints = slotTextFingerprints.get(next.language)
    if (fingerprints?.has(fingerprint)) return 'duplicate'
    fingerprints?.add(fingerprint)
    const existing = slots[existingIndex]
    if (!existing) return 'duplicate'
    slots[existingIndex] = {
      ...existing,
      descriptor: [existing.descriptor, next.descriptor].filter(Boolean).join(' / '),
      representation:
        existing.representation === 'synchronised' || next.representation === 'synchronised'
          ? 'synchronised'
          : 'plain',
      text: `${existing.text}\n\n${next.text}`,
      sourceCount: (existing.sourceCount ?? 1) + 1,
    }
    return 'merged'
  }

  for (const [index, item] of (lyrics ?? []).entries()) {
    const plainText = item.text ?? ''
    const synchronisedText = (item.syncText ?? []).length ? synchronisedLyricsText(item) : ''
    const text = synchronisedText || plainText
    if (!text) continue
    const declaredLanguage = normalizeLyricsLanguage(item.language || inferredNativeLanguage)
    const language = isLyricsLanguage(declaredLanguage)
      ? declaredLanguage
      : defaultLyricsLanguage
    if (language !== declaredLanguage) {
      warnings.push(
        `歌词槽位 ${index + 1} 的语言码“${item.language ?? ''}”不可用，已作为 ${defaultLyricsLanguage} 导入。`,
      )
    }
    const next: LyricsSlot = {
      id: `lyrics-${index}`,
      language,
      descriptor: item.descriptor ?? '',
      representation: synchronisedText || hasLrcTimestamp(text) ? 'synchronised' : 'plain',
      text,
      sourceCount: 1,
    }
    const result = append(next)
    standardTextFingerprints.add(sourceFingerprint(language, text))
    if (result === 'merged' && !warnedLanguages.has(language)) {
      warnedLanguages.add(language)
      warnings.push(
        `检测到多个 ${language} 歌词来源，已合并为一个可编辑语言槽位；导出副本只会尝试写回一个 ${language} 槽位。`,
      )
    }
  }

  let nativeIndex = 0
  for (const tag of tags) {
    const kind = nativeLyricsTagKind(tag.id)
    if (!kind) continue
    for (const value of nativeLyricsValues(tag.value)) {
      const fingerprint = lyricsTextFingerprint(value.text)
      const declaredLanguage = normalizeLyricsLanguage(
        value.language ??
          kind.language ??
          languagesByType.get(tag.type) ??
          defaultLyricsLanguage,
      )
      const language = isLyricsLanguage(declaredLanguage)
        ? declaredLanguage
        : defaultLyricsLanguage
      // `common.lyrics` is the parser's canonical representation of standard
      // USLT/SYLT, Vorbis, MP4, ASF, and APE lyrics. Only use native metadata
      // as a compatibility fallback so a standard frame is not shown twice.
      if (
        !fingerprint ||
        standardTextFingerprints.has(sourceFingerprint(language, value.text))
      ) {
        continue
      }
      if (language !== declaredLanguage) {
        warnings.push(
          `原始歌词标签 ${tag.id} 的语言码“${declaredLanguage}”不可用，已作为 ${defaultLyricsLanguage} 导入。`,
        )
      }
      const result = append({
        id: `lyrics-native-${nativeIndex}`,
        language,
        descriptor: value.descriptor ?? '',
        representation:
          value.representation === 'synchronised' || kind.representation === 'synchronised'
            ? 'synchronised'
            : 'plain',
        text: value.text,
        sourceCount: 1,
      })
      if (result !== 'duplicate') nativeIndex += 1
    }
  }

  return { slots, warnings }
}

const normalizeCoverKind = (picture: IPicture): CoverArtwork['kind'] => {
  const type = picture.type?.toLowerCase() ?? ''
  if (type.includes('back')) return 'back'
  if (type.includes('disc') || type.includes('media')) return 'disc'
  if (type.includes('artist') || type.includes('performer')) return 'artist'
  if (type.includes('front') || type.includes('cover')) return 'front'
  return 'other'
}

const mapPicture = (picture: IPicture, index: number): CoverArtwork => {
  const blob = new Blob([new Uint8Array(picture.data).buffer], {
    type: picture.format || 'application/octet-stream',
  })
  return {
    id: `embedded-${index}`,
    kind: normalizeCoverKind(picture),
    mime: blob.type,
    size: blob.size,
    source: 'embedded',
    previewUrl: URL.createObjectURL(blob),
  }
}

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const xmpPrivateMetadataReadNotice =
  '检测到 XMP 私有元数据；MINFO 暂不编辑，导出后不承诺逐字保留。'

const xmpPrivateMetadataWarning = /^unknown priv owner-identifier:\s*xmp$/iu
const maximumXmpPrivateMetadataBytes = 65_536

const startsWithBytes = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((byte, index) => bytes[index] === byte)

const decodePrivateMetadata = (data: Uint8Array): string | null => {
  if (data.byteLength > maximumXmpPrivateMetadataBytes) return null
  const encoding = startsWithBytes(data, [0xff, 0xfe])
    ? 'utf-16le'
    : startsWithBytes(data, [0xfe, 0xff])
      ? 'utf-16be'
      : 'utf-8'
  const body = encoding === 'utf-8' ? data : data.subarray(2)

  try {
    return new TextDecoder(encoding, { fatal: true }).decode(body).replace(/^\uFEFF/u, '')
  } catch {
    return null
  }
}

const isWellFormedXmpDocument = (text: string): boolean => {
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) return false
  const root = document.documentElement
  return root.localName === 'xmpmeta' && root.namespaceURI === 'adobe:ns:meta/'
}

const isVerifiedXmpPrivateMetadata = (id: string, value: unknown): boolean => {
  if (
    id.trim().toUpperCase() !== 'PRIV' ||
    !isRecord(value) ||
    typeof value.owner_identifier !== 'string' ||
    value.owner_identifier.trim().toUpperCase() !== 'XMP' ||
    !(value.data instanceof Uint8Array)
  ) {
    return false
  }

  const text = decodePrivateMetadata(value.data)
  return Boolean(text && isWellFormedXmpDocument(text))
}

export const isOpaquePrivateNativeTag = (tag: NativeTag): boolean =>
  tag.handling === 'opaque-private'

export interface ClassifiedMetadataQualityMessages {
  readonly warnings: readonly string[]
  readonly readNotices: readonly string[]
}

/**
 * Reclassifies stable, recognized parser diagnostics without suppressing
 * genuinely unknown metadata or malformed-file warnings.
 */
export const classifyMetadataQualityMessages = (
  messages: readonly string[],
  hasVerifiedXmpPrivateMetadata = false,
): ClassifiedMetadataQualityMessages => {
  const warnings: string[] = []
  for (const message of messages) {
    if (hasVerifiedXmpPrivateMetadata && xmpPrivateMetadataWarning.test(message.trim()))
      continue
    warnings.push(message)
  }
  return {
    warnings,
    readNotices: hasVerifiedXmpPrivateMetadata ? [xmpPrivateMetadataReadNotice] : [],
  }
}

export const collectNativeTags = (metadata: IAudioMetadata): NativeTag[] =>
  Object.entries(metadata.native).flatMap(([type, tags]) =>
    tags.map((tag) => ({
      type,
      id: tag.id,
      value: toText(tag.value),
      ...(isVerifiedXmpPrivateMetadata(tag.id, tag.value)
        ? { handling: 'opaque-private' as const }
        : {}),
    })),
  )

export const editableTextTags = (nativeTags: readonly NativeTag[]): EditableTag[] =>
  nativeTags
    // Structured native values (artwork, comments with descriptors, lyrics
    // frames, etc.) are shown as read-only technical facts. Recognized lyric
    // aliases are managed exclusively by the dedicated lyrics slots, avoiding
    // two editable controls for the same source value. The generic editor only
    // emits scalar text metadata and must not serialize JSON back as a fake tag
    // value.
    .filter(
      (tag) =>
        !isOpaquePrivateNativeTag(tag) &&
        !isManagedLyricsNativeTag(tag.id) &&
        tag.value &&
        !tag.value.startsWith('[') &&
        !tag.value.startsWith('{') &&
        !tag.value.startsWith('"'),
    )
    .map((tag, index) => ({
      id: `${tag.type}-${tag.id}-${index}`,
      key: tag.id,
      value: tag.value,
    }))

const toTechnicalInfo = (file: File, metadata: IAudioMetadata): TechnicalInfo => {
  const duration = metadata.format.duration
  const sampleRate = metadata.format.sampleRate
  const channels = metadata.format.numberOfChannels
  const bitrate = metadata.format.bitrate ?? metadata.format.overallBitrate
  const lossless = metadata.format.lossless
  return {
    extension: getExtension(file.name) || 'unknown',
    mime: file.type || '未提供',
    container: metadata.format.container ?? '未能读取',
    codec: metadata.format.codec ?? '未能读取',
    ...(duration === undefined ? {} : { duration }),
    ...(sampleRate === undefined ? {} : { sampleRate }),
    ...(channels === undefined ? {} : { channels }),
    ...(bitrate === undefined ? {} : { bitrate }),
    ...(lossless === undefined ? {} : { lossless }),
    tagTypes: metadata.format.tagTypes,
  }
}

export const getFileIdentity = (file: File): FileIdentity => ({
  name: file.name,
  size: file.size,
  lastModified: file.lastModified,
})

export const inspectAudioFile = async (file: File): Promise<InspectionResult> => {
  const metadata = await parseBlob(file, { duration: true })
  const { common } = metadata
  const nativeTags = collectNativeTags(metadata)
  const hasVerifiedXmpPrivateMetadata = nativeTags.some(isOpaquePrivateNativeTag)
  const qualityMessages = classifyMetadataQualityMessages(
    metadata.quality.warnings.map((warning) => warning.message),
    hasVerifiedXmpPrivateMetadata,
  )
  const lyricSlots = parseLyricsSlots(common.lyrics, metadata.native)
  const mainComment = common.comment?.[0]

  return {
    draft: {
      ...emptyDraft(),
      title: common.title ?? '',
      artists: common.artists ?? (common.artist ? [common.artist] : []),
      album: common.album ?? '',
      albumArtists: common.albumartists ?? (common.albumartist ? [common.albumartist] : []),
      genres: common.genre ?? [],
      releaseDate: common.date ?? common.releasedate ?? common.year?.toString() ?? '',
      comment: mainComment?.text ?? '',
      trackNo: common.track.no?.toString() ?? '',
      trackTotal: common.track.of?.toString() ?? '',
      discNo: common.disk.no?.toString() ?? '',
      discTotal: common.disk.of?.toString() ?? '',
      composers: common.composer ?? [],
      lyricsSlots: lyricSlots.slots,
      covers: (common.picture ?? []).map(mapPicture),
      rawTags: editableTextTags(nativeTags),
    },
    technical: toTechnicalInfo(file, metadata),
    nativeTags,
    warnings: [...qualityMessages.warnings, ...lyricSlots.warnings],
    readNotices: qualityMessages.readNotices,
  }
}

export const readableInspectionError = (error: unknown): string => {
  if (error instanceof Error) {
    if (/unsupported|determine.*file.*type/i.test(error.message)) {
      return '无法识别这个文件的音频容器。请确认它是有效的音频文件。'
    }

    return `未能读取嵌入元信息：${error.message}`
  }

  return '未能读取嵌入元信息。请重新选择文件或使用本机 FFmpeg 命令。'
}
