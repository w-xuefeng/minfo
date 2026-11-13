import type { BrowserOutputFormat } from './audio-formats'

/**
 * The semantic lyrics fields in MINFO's editable slot model. These are not
 * container atoms: each output format maps them to its own FFmpeg metadata
 * keys, or explicitly declares that it cannot carry them.
 */
export const lyricsFormatFieldIds = [
  'primaryText',
  'primaryLanguage',
  'additionalLanguageSlots',
] as const

export type LyricsFormatField = (typeof lyricsFormatFieldIds)[number]

export type LyricsMetadataKeyTemplate = 'lyrics' | 'lyrics_language' | 'lyrics-{language}'

export interface LyricsFormatFieldCapability {
  /** FFmpeg's metadata key (or language-key template) for this semantic field. */
  readonly metadataKeyTemplate: LyricsMetadataKeyTemplate
  /** Whether MINFO writes this field for this output target. */
  readonly write: boolean
  /** Whether the written field must be present/absent in FFprobe readback. */
  readonly verify: boolean
  /** Required when the target cannot express a user-visible slot field. */
  readonly unsupportedDescription?: string
}

export interface LyricsFormatCapability {
  readonly fields: Readonly<Record<LyricsFormatField, LyricsFormatFieldCapability>>
  /**
   * Source-specific aliases such as `TXXX:lyrics-eng` can only be replaced
   * and required to disappear when the target's generic metadata path exposes
   * those aliases.
   */
  readonly manageSourceAliases: boolean
  /**
   * Some containers let the secondary parser reconstruct language-qualified
   * slots. It is a supplementary veto only where that reconstruction is real.
   */
  readonly verifyParsedLanguageManifest: boolean
}

const fullyVerifiableLyricsFields = (): LyricsFormatCapability['fields'] => ({
  primaryText: {
    metadataKeyTemplate: 'lyrics',
    write: true,
    verify: true,
  },
  primaryLanguage: {
    metadataKeyTemplate: 'lyrics_language',
    write: true,
    verify: true,
  },
  additionalLanguageSlots: {
    metadataKeyTemplate: 'lyrics-{language}',
    write: true,
    verify: true,
  },
})

/**
 * Browser-output lyrics capability catalogue.
 *
 * This is deliberately separate from UI editability: a target can still let a
 * user edit lyrics while only retaining the subset its container can express.
 * Command construction, preflight warnings and browser readback all consume
 * this catalogue rather than branching on an output-format name.
 */
export const lyricsFormatCapabilitiesByFormat = {
  mp3: {
    fields: fullyVerifiableLyricsFields(),
    manageSourceAliases: true,
    verifyParsedLanguageManifest: true,
  },
  m4a: {
    fields: {
      primaryText: {
        metadataKeyTemplate: 'lyrics',
        write: true,
        verify: true,
      },
      primaryLanguage: {
        metadataKeyTemplate: 'lyrics_language',
        write: false,
        verify: false,
        unsupportedDescription:
          'M4A 当前的 FFmpeg MOV/IPOD 写入路径只提供 ©lyr 普通歌词，不提供独立的歌词语言码字段。',
      },
      additionalLanguageSlots: {
        metadataKeyTemplate: 'lyrics-{language}',
        write: false,
        verify: false,
        unsupportedDescription:
          'M4A 当前的 FFmpeg MOV/IPOD 写入路径只能保存一份 ©lyr 普通歌词，不能保存其他语言的独立歌词槽位。',
      },
    },
    manageSourceAliases: false,
    verifyParsedLanguageManifest: false,
  },
  aac: {
    fields: fullyVerifiableLyricsFields(),
    manageSourceAliases: true,
    verifyParsedLanguageManifest: true,
  },
} as const satisfies Readonly<Record<BrowserOutputFormat, LyricsFormatCapability>>

/**
 * The local arbitrary-format command path has no browser support contract.
 * Retain the historical generic FFmpeg metadata request there; local users
 * inspect the rendered command and validate its target themselves.
 */
export const genericLocalLyricsFormatCapability: LyricsFormatCapability = {
  fields: fullyVerifiableLyricsFields(),
  manageSourceAliases: false,
  verifyParsedLanguageManifest: false,
}

export const lyricsFormatCapabilityFor = (
  format: BrowserOutputFormat,
): LyricsFormatCapability => lyricsFormatCapabilitiesByFormat[format]
