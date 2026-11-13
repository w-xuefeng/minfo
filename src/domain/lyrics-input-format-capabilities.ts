import type { LyricsSlot } from './model'

/**
 * Evidence emitted by the tag parser while reading an input file. This is
 * deliberately independent from filename extensions and export targets.
 */
export interface LyricsInputSource {
  readonly container?: string
  readonly codec?: string
  readonly tagTypes?: readonly string[]
  readonly nativeTagTypes?: readonly string[]
}

export const lyricsInputFormatIds = ['mp3', 'm4a', 'aac', 'generic'] as const

export type LyricsInputFormat = (typeof lyricsInputFormatIds)[number]

export interface LyricsInputNativeTagAlias {
  /** Normalized tag name; reader normalization handles punctuation and casing. */
  readonly name: string
  readonly representation: LyricsSlot['representation']
  /** Whether a trailing `-<language>` is meaningful for this source alias. */
  readonly acceptsLanguageSuffix: boolean
}

export interface LyricsInputFormatMatcher {
  /** At least one normalized container value must contain one of these terms. */
  readonly containerTerms: readonly string[]
  /** When supplied, at least one normalized codec value must contain one of these terms. */
  readonly codecTerms?: readonly string[]
  /** A matching container is rejected when it contains one of these terms. */
  readonly excludedContainerTerms?: readonly string[]
}

export interface LyricsInputFormatCapability {
  readonly id: LyricsInputFormat
  /** Omitted only by the conservative generic fallback. */
  readonly matcher?: LyricsInputFormatMatcher
  /** Empty means that every parser-native tag family is eligible. */
  readonly nativeTagTypeTerms: readonly string[]
  readonly nativeLyricsAliases: readonly LyricsInputNativeTagAlias[]
  /** Normalized names for auxiliary ordinary-lyrics language tags. */
  readonly languageDeclarationAliases: readonly string[]
  /** Whether `common.lyrics` retains its reported/auxiliary language. */
  readonly commonLyricsLanguage: 'reported-or-declared' | 'und'
  /** A non-blocking source fact emitted once when lyrics are forced to `und`. */
  readonly defaultLanguageNotice?: string
  /** Omitted means the source path can expose multiple language slots. */
  readonly maximumSlots?: number
  /** Shown once if distinct source lyrics exceed `maximumSlots`. */
  readonly maximumSlotsWarning?: string
}

const id3LyricsAliases: readonly LyricsInputNativeTagAlias[] = [
  { name: 'unsynchronized-lyrics', representation: 'plain', acceptsLanguageSuffix: true },
  { name: 'unsynchronised-lyrics', representation: 'plain', acceptsLanguageSuffix: true },
  { name: 'synchronized-lyrics', representation: 'synchronised', acceptsLanguageSuffix: true },
  { name: 'synchronised-lyrics', representation: 'synchronised', acceptsLanguageSuffix: true },
  { name: 'unsynced-lyrics', representation: 'plain', acceptsLanguageSuffix: true },
  { name: 'synced-lyrics', representation: 'synchronised', acceptsLanguageSuffix: true },
  { name: 'unsynchronizedlyrics', representation: 'plain', acceptsLanguageSuffix: true },
  { name: 'unsynchronisedlyrics', representation: 'plain', acceptsLanguageSuffix: true },
  { name: 'synchronizedlyrics', representation: 'synchronised', acceptsLanguageSuffix: true },
  { name: 'synchronisedlyrics', representation: 'synchronised', acceptsLanguageSuffix: true },
  { name: 'unsyncedlyrics', representation: 'plain', acceptsLanguageSuffix: true },
  { name: 'syncedlyrics', representation: 'synchronised', acceptsLanguageSuffix: true },
  { name: 'sylt', representation: 'synchronised', acceptsLanguageSuffix: true },
  { name: 'uslt', representation: 'plain', acceptsLanguageSuffix: true },
  { name: 'ult', representation: 'plain', acceptsLanguageSuffix: true },
  { name: 'lyrics', representation: 'plain', acceptsLanguageSuffix: true },
  { name: 'lyric', representation: 'plain', acceptsLanguageSuffix: true },
]

const commonLanguageDeclarationAliases = [
  'lyrics-language',
  'language-lyrics',
  'lyricslanguage',
  'languagelyrics',
] as const

/**
 * Source-container catalogue for import. It deliberately does not borrow the
 * output catalogue: readable aliases and writable output fields are separate
 * contracts.
 */
export const lyricsInputFormatCapabilities: Readonly<
  Record<LyricsInputFormat, LyricsInputFormatCapability>
> = {
  mp3: {
    id: 'mp3',
    matcher: {
      containerTerms: ['mpeg'],
      codecTerms: ['layer 3', 'mp3'],
    },
    nativeTagTypeTerms: ['id3'],
    nativeLyricsAliases: id3LyricsAliases,
    languageDeclarationAliases: commonLanguageDeclarationAliases,
    commonLyricsLanguage: 'reported-or-declared',
  },
  m4a: {
    id: 'm4a',
    matcher: {
      containerTerms: ['mpeg-4', 'mp4', 'm4a'],
      excludedContainerTerms: ['adts'],
    },
    nativeTagTypeTerms: ['mp4', 'itunes'],
    nativeLyricsAliases: [
      { name: '©lyr', representation: 'plain', acceptsLanguageSuffix: false },
    ],
    languageDeclarationAliases: [],
    commonLyricsLanguage: 'und',
    defaultLanguageNotice: 'M4A 的 ©lyr 不带标准歌词语言码，已作为 und 导入。',
    maximumSlots: 1,
    maximumSlotsWarning: 'M4A 的标准歌词字段只能读取一份普通歌词；额外不同歌词未进入编辑器。',
  },
  aac: {
    id: 'aac',
    matcher: {
      containerTerms: ['adts'],
      codecTerms: ['aac'],
    },
    nativeTagTypeTerms: ['id3'],
    nativeLyricsAliases: id3LyricsAliases,
    languageDeclarationAliases: commonLanguageDeclarationAliases,
    commonLyricsLanguage: 'reported-or-declared',
  },
  generic: {
    id: 'generic',
    nativeTagTypeTerms: [],
    nativeLyricsAliases: [
      ...id3LyricsAliases,
      { name: '©lyr', representation: 'plain', acceptsLanguageSuffix: false },
    ],
    languageDeclarationAliases: commonLanguageDeclarationAliases,
    commonLyricsLanguage: 'reported-or-declared',
  },
}

const normalizeEvidence = (value: string | undefined): string =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_.:/\s]+/g, '-')

const includesAnyTerm = (value: string | undefined, terms: readonly string[]): boolean => {
  const normalized = normalizeEvidence(value)
  return terms.some((term) => normalized.includes(normalizeEvidence(term)))
}

const includesAnyTagTypeTerm = (source: LyricsInputSource, terms: readonly string[]): boolean =>
  [...(source.tagTypes ?? []), ...(source.nativeTagTypes ?? [])].some((type) =>
    includesAnyTerm(type, terms),
  )

const matches = (
  source: LyricsInputSource,
  capability: LyricsInputFormatCapability,
): boolean => {
  const matcher = capability.matcher
  if (!matcher) return false

  if (source.container?.trim()) {
    if (!includesAnyTerm(source.container, matcher.containerTerms)) return false
    if (
      matcher.excludedContainerTerms &&
      includesAnyTerm(source.container, matcher.excludedContainerTerms)
    ) {
      return false
    }
    return !matcher.codecTerms || includesAnyTerm(source.codec, matcher.codecTerms)
  }

  // Some parser versions omit a container label for damaged files. A native
  // tag family plus a codec can still identify an ID3/MP4 source safely; if
  // evidence remains incomplete, use the generic fallback instead.
  if (!includesAnyTagTypeTerm(source, capability.nativeTagTypeTerms)) return false
  return !matcher.codecTerms || includesAnyTerm(source.codec, matcher.codecTerms)
}

/** Resolve a source profile from parser evidence, never from an extension. */
export const lyricsInputCapabilityForSource = (
  source: LyricsInputSource = {},
): LyricsInputFormatCapability => {
  for (const id of lyricsInputFormatIds) {
    const capability = lyricsInputFormatCapabilities[id]
    if (matches(source, capability)) return capability
  }
  return lyricsInputFormatCapabilities.generic
}
