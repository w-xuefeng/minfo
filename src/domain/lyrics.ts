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

/**
 * The first slot is the ordinary, broadly-readable lyrics field. Additional
 * slots use language-qualified ordinary tags; the export plan flags their
 * cross-container interoperability as a confirmation risk.
 */
export const ordinaryLyricsMetadataTags = (
  slots: readonly LyricsSlot[],
): readonly OrdinaryLyricsMetadataTag[] =>
  normalizeLyricsSlots(slots).flatMap<OrdinaryLyricsMetadataTag>((slot, index) => {
    if (!isLyricsLanguage(slot.language)) {
      throw new Error(lyricsLanguageValidationMessage)
    }
    if (index === 0) {
      return [
        { key: 'lyrics', value: slot.text, language: slot.language, primary: true },
        {
          key: 'lyrics_language',
          value: slot.language,
          language: slot.language,
          primary: true,
        },
      ]
    }
    return [
      {
        key: `lyrics-${slot.language}`,
        value: slot.text,
        language: slot.language,
        primary: false,
      },
    ]
  })

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
