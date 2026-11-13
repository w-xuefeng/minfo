import {
  genericLocalLyricsFormatCapability,
  lyricsFormatCapabilityFor,
  type LyricsFormatCapability,
  type LyricsFormatField,
  type LyricsMetadataKeyTemplate,
} from './lyrics-format-capabilities'
import type { BrowserOutputFormat } from './audio-formats'
import type { LyricsSlot } from './model'

/** Values offered before the user creates a different language code. */
export const suggestedLyricsLanguages = [
  'und',
  'zho',
  'eng',
  'jpn',
  'kor',
  'fra',
  'deu',
  'spa',
  'ita',
  'rus',
  'por',
  'ara',
  'hin',
  'tha',
  'vie',
  'ind',
  'msa',
  'tam',
  'ben',
  'tur',
  'pol',
  'nld',
  'swe',
  'dan',
  'fin',
  'nor',
  'ces',
  'hun',
  'ron',
  'ukr',
  'ell',
  'heb',
  'cat',
  'fil',
] as const

export type SuggestedLyricsLanguage = (typeof suggestedLyricsLanguages)[number]

export const suggestedLyricsLanguageLabels: Readonly<Record<SuggestedLyricsLanguage, string>> =
  {
    und: '未指定',
    zho: '中文',
    eng: '英语',
    jpn: '日语',
    kor: '韩语',
    fra: '法语',
    deu: '德语',
    spa: '西班牙语',
    ita: '意大利语',
    rus: '俄语',
    por: '葡萄牙语',
    ara: '阿拉伯语',
    hin: '印地语',
    tha: '泰语',
    vie: '越南语',
    ind: '印尼语',
    msa: '马来语',
    tam: '泰米尔语',
    ben: '孟加拉语',
    tur: '土耳其语',
    pol: '波兰语',
    nld: '荷兰语',
    swe: '瑞典语',
    dan: '丹麦语',
    fin: '芬兰语',
    nor: '挪威语',
    ces: '捷克语',
    hun: '匈牙利语',
    ron: '罗马尼亚语',
    ukr: '乌克兰语',
    ell: '希腊语',
    heb: '希伯来语',
    cat: '加泰罗尼亚语',
    fil: '菲律宾语',
  }

export const suggestedLyricsLanguageLabel = (language: string): string | undefined =>
  suggestedLyricsLanguageLabels[language as SuggestedLyricsLanguage]

export const defaultLyricsLanguage = suggestedLyricsLanguages[0]

// Accept an ISO-style primary code with optional BCP 47-style subtags. This
// remains deliberately narrow because the value also becomes part of a
// language-qualified ordinary metadata key such as `lyrics-zho`.
const languagePattern = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/
const maximumLanguageLength = 35

export const normalizeLyricsLanguage = (value: string): string => value.trim().toLowerCase()

const lrcTimestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

/**
 * Compare LRC text without treating a parser's timestamp-precision formatting
 * (for example `.81` versus `.810`) as a lyrics edit. Deliberately preserves
 * all non-timestamp characters and blank lines.
 */
export const canonicalizeLyricsTextForComparison = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(
      lrcTimestampPattern,
      (_match, minutes: string, seconds: string, fraction?: string) => {
        const milliseconds =
          Number(minutes) * 60_000 +
          Number(seconds) * 1_000 +
          (fraction ? Number(fraction) * 10 ** (3 - fraction.length) : 0)
        return `[${milliseconds}]`
      },
    )

export const isLyricsLanguage = (value: string): boolean => {
  const normalized = normalizeLyricsLanguage(value)
  return normalized.length <= maximumLanguageLength && languagePattern.test(normalized)
}

export const lyricsLanguageValidationMessage =
  '歌词语言请使用 2-8 个小写字母的语言码，可附带以连字符分隔的子标签，例如 und、zho、eng 或 jpn。'

/** Normalize external/UI input without altering the lyrics text itself. */
export const normalizeLyricsSlots = (slots: readonly LyricsSlot[]): readonly LyricsSlot[] =>
  slots.map((slot) => ({ ...slot, language: normalizeLyricsLanguage(slot.language) }))

export const duplicateLyricsLanguages = (slots: readonly LyricsSlot[]): readonly string[] => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const slot of slots) {
    const language = normalizeLyricsLanguage(slot.language)
    if (seen.has(language)) duplicates.add(language)
    seen.add(language)
  }
  return [...duplicates]
}

export interface OrdinaryLyricsMetadataTag {
  readonly key: string
  readonly value: string
  readonly language: string
  readonly primary: boolean
}

interface LyricsMetadataEntry extends OrdinaryLyricsMetadataTag {
  readonly field: LyricsFormatField
}

export interface LyricsFormatLimitation {
  readonly field: LyricsFormatField
  readonly languages: readonly string[]
  readonly description: string
}

const metadataKey = (template: LyricsMetadataKeyTemplate, language: string): string =>
  template.replace('{language}', language)

const metadataEntriesForCapability = (
  slots: readonly LyricsSlot[],
  capability: LyricsFormatCapability,
): readonly LyricsMetadataEntry[] =>
  normalizeLyricsSlots(slots).flatMap<LyricsMetadataEntry>((slot, index) => {
    if (!isLyricsLanguage(slot.language)) {
      throw new Error(lyricsLanguageValidationMessage)
    }

    if (index === 0) {
      const entries: LyricsMetadataEntry[] = []
      const primaryText = capability.fields.primaryText
      if (primaryText.write) {
        entries.push({
          field: 'primaryText',
          key: metadataKey(primaryText.metadataKeyTemplate, slot.language),
          value: slot.text,
          language: slot.language,
          primary: true,
        })
      }
      const primaryLanguage = capability.fields.primaryLanguage
      if (primaryLanguage.write) {
        entries.push({
          field: 'primaryLanguage',
          key: metadataKey(primaryLanguage.metadataKeyTemplate, slot.language),
          value: slot.language,
          language: slot.language,
          primary: true,
        })
      }
      return entries
    }

    const additionalSlots = capability.fields.additionalLanguageSlots
    return additionalSlots.write
      ? [
          {
            field: 'additionalLanguageSlots',
            key: metadataKey(additionalSlots.metadataKeyTemplate, slot.language),
            value: slot.text,
            language: slot.language,
            primary: false,
          },
        ]
      : []
  })

const asOrdinaryLyricsMetadataTag = (
  entry: LyricsMetadataEntry,
): OrdinaryLyricsMetadataTag => ({
  key: entry.key,
  value: entry.value,
  language: entry.language,
  primary: entry.primary,
})

/**
 * The generic local-command behavior used before format-specific browser
 * support existed. Browser exports must use `ordinaryLyricsMetadataTagsForFormat`.
 */
export const ordinaryLyricsMetadataTags = (
  slots: readonly LyricsSlot[],
): readonly OrdinaryLyricsMetadataTag[] =>
  metadataEntriesForCapability(slots, genericLocalLyricsFormatCapability).map(
    asOrdinaryLyricsMetadataTag,
  )

/**
 * The exact generic metadata fields that the selected browser target can
 * write. For M4A this intentionally contains only the primary `lyrics` field;
 * FFmpeg maps it to the M4A `©lyr` atom and ignores the ID3-style helpers.
 */
export const ordinaryLyricsMetadataTagsForFormat = (
  format: BrowserOutputFormat,
  slots: readonly LyricsSlot[],
): readonly OrdinaryLyricsMetadataTag[] =>
  metadataEntriesForCapability(slots, lyricsFormatCapabilityFor(format)).map(
    asOrdinaryLyricsMetadataTag,
  )

/**
 * Fields that the requested target cannot represent from the current editable
 * slot collection. The caller turns these into a preflight acknowledgement;
 * they must never become an impossible FFprobe-readback requirement.
 */
export const lyricsFormatLimitations = (
  format: BrowserOutputFormat,
  slots: readonly LyricsSlot[],
): readonly LyricsFormatLimitation[] => {
  const normalizedSlots = normalizeLyricsSlots(slots)
  if (normalizedSlots.length === 0) return []

  const capability = lyricsFormatCapabilityFor(format)
  const limitations: LyricsFormatLimitation[] = []
  const addIfUnsupported = (field: LyricsFormatField, languages: readonly string[]): void => {
    const config = capability.fields[field]
    if (config.write || languages.length === 0) return
    limitations.push({
      field,
      languages,
      description: config.unsupportedDescription ?? '当前目标格式无法表达此歌词字段。',
    })
  }

  addIfUnsupported('primaryText', [normalizedSlots[0]!.language])
  addIfUnsupported('primaryLanguage', [normalizedSlots[0]!.language])
  addIfUnsupported(
    'additionalLanguageSlots',
    normalizedSlots.slice(1).map((slot) => slot.language),
  )
  return limitations
}

const configuredMetadataKeys = (
  slots: readonly LyricsSlot[],
  capability: LyricsFormatCapability,
  includes: (field: LyricsFormatField) => boolean,
): readonly string[] => {
  const normalizedSlots = normalizeLyricsSlots(slots)
  if (normalizedSlots.length === 0) return []

  const primaryLanguage = normalizedSlots[0]!.language
  const keys = new Set<string>()
  if (includes('primaryText')) {
    keys.add(metadataKey(capability.fields.primaryText.metadataKeyTemplate, primaryLanguage))
  }
  if (includes('primaryLanguage')) {
    keys.add(
      metadataKey(capability.fields.primaryLanguage.metadataKeyTemplate, primaryLanguage),
    )
  }
  if (includes('additionalLanguageSlots')) {
    normalizedSlots.forEach((slot) =>
      keys.add(
        metadataKey(
          capability.fields.additionalLanguageSlots.metadataKeyTemplate,
          slot.language,
        ),
      ),
    )
  }
  return [...keys]
}

/**
 * Metadata keys to clear before adding the slot manifest. This uses the same
 * target configuration as writing, so M4A never receives ID3-style language
 * helper writes that its MOV/IPOD muxer cannot preserve.
 */
export const lyricsMetadataKeysToClearForFormat = (
  format: BrowserOutputFormat,
  originalSlots: readonly LyricsSlot[],
  draftSlots: readonly LyricsSlot[],
  managedSourceTagKeys: readonly string[] = [],
): readonly string[] => {
  const capability = lyricsFormatCapabilityFor(format)
  const keys = new Set<string>()
  if (capability.manageSourceAliases) {
    managedSourceTagKeys
      .map((key) => key.trim())
      .filter(Boolean)
      .forEach((key) => keys.add(key))
  }
  const addsWrittenField = (field: LyricsFormatField): boolean => capability.fields[field].write
  configuredMetadataKeys(originalSlots, capability, addsWrittenField).forEach((key) =>
    keys.add(key),
  )
  configuredMetadataKeys(draftSlots, capability, addsWrittenField).forEach((key) =>
    keys.add(key),
  )
  return [...keys]
}

/**
 * FFprobe keys that are a hard verification contract for this target. Source
 * aliases only participate for formats whose generic metadata path can expose
 * them; M4A deliberately verifies `lyrics`/`©lyr` alone.
 */
export const lyricsVerificationMetadataKeysForFormat = (
  format: BrowserOutputFormat,
  originalSlots: readonly LyricsSlot[],
  draftSlots: readonly LyricsSlot[],
  managedSourceTagKeys: readonly string[] = [],
): readonly string[] => {
  const capability = lyricsFormatCapabilityFor(format)
  const keys = new Set<string>()
  if (capability.manageSourceAliases) {
    managedSourceTagKeys
      .map((key) => key.trim())
      .filter(Boolean)
      .forEach((key) => keys.add(key))
  }
  const addsVerifiableField = (field: LyricsFormatField): boolean =>
    capability.fields[field].verify
  configuredMetadataKeys(originalSlots, capability, addsVerifiableField).forEach((key) =>
    keys.add(key),
  )
  configuredMetadataKeys(draftSlots, capability, addsVerifiableField).forEach((key) =>
    keys.add(key),
  )
  return [...keys]
}

export const verifiesParsedLyricsLanguageManifest = (format: BrowserOutputFormat): boolean =>
  lyricsFormatCapabilityFor(format).verifyParsedLanguageManifest

/**
 * Metadata keys that may represent these slots after an FFmpeg container
 * round-trip. The first slot is normally generic `lyrics`, but an input ID3
 * USLT/SYLT can surface as `lyrics-{language}` instead, so both forms must be
 * considered when replacing a lyrics manifest.
 */
export const lyricsManifestMetadataKeys = (slots: readonly LyricsSlot[]): readonly string[] => [
  ...new Set([
    ...ordinaryLyricsMetadataTags(slots).map((tag) => tag.key),
    ...normalizeLyricsSlots(slots).map((slot) => `lyrics-${slot.language}`),
  ]),
]
