import type { BrowserOutputFormat } from './audio-formats'
import type { CoverArtwork } from './model'

/** How the target's standard form fields are authoritatively read back. */
export type StandardMetadataReadback = 'music-metadata-common' | 'ffprobe-format-tags'

/** When the output audio codec must match the configured target codec. */
export type AudioCodecReadback = 'when-transcoded' | 'always'

/** Whether the target can carry embedded artwork at all. */
export type CoverWriteCapability = 'embedded' | 'omitted'

/** The strongest identity comparison the target's artwork model can support. */
export type CoverReadbackComparison =
  'ordered-mime-size-kind' | 'unordered-mime-size' | 'must-be-empty'

/** How much of MINFO's ID3-style artwork-role model survives the target. */
export type CoverRoleReadback = 'exact' | 'implicit-front-when-single' | 'unavailable'

/** Whether changed native keys can be compared after an output remux. */
export type RawTagReadback = 'always' | 'same-container-only' | 'none'

export interface OutputVerificationCapability {
  readonly probe: {
    readonly acceptedContainerNames: readonly string[]
    readonly expectedAudioCodec: 'mp3' | 'aac'
    readonly audioCodecReadback: AudioCodecReadback
  }
  readonly standardMetadata: {
    readonly reader: StandardMetadataReadback
    /** FFprobe serializes multi-value fields with this configured separator. */
    readonly multiValueSeparator: string
  }
  readonly covers: {
    readonly write: CoverWriteCapability
    readonly comparison: CoverReadbackComparison
    readonly roleReadback: CoverRoleReadback
    /** Normalized image MIME values accepted by the target muxer. */
    readonly embeddableMimes: readonly string[]
    /**
     * Whether a local command may retain every source visual stream when the
     * browser cannot address the individual attachment. Browser exports never
     * use this escape hatch; it remains explicit for future proven targets.
     */
    readonly allowUnmappedSourceVisualStreamCopy: boolean
    /** Shown before a target omits images it cannot represent. */
    readonly omissionDescription?: string
    /** Shown before the target drops role or ordering semantics. */
    readonly roleDowngradeDescription?: string
  }
  readonly rawTags: {
    readonly readback: RawTagReadback
    /** Shown when a changed native key cannot retain its native identity. */
    readonly crossContainerDescription?: string
  }
}

const allAcceptedCoverMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
const m4aCoverMimes = ['image/png', 'image/jpeg'] as const

const crossContainerRawTagDescription =
  '目标容器不能证明高级原始标签仍使用相同的原生键、描述符或槽位；确认后会尽力映射，但不会以逐键回读失败取消新副本下载。'

/**
 * Browser-output readback policy catalogue.
 *
 * This is intentionally separate from the selector, editor capabilities, and
 * lyrics capabilities. The planner, FFmpeg artwork mapping, and post-export
 * verifier all consume this same contract so a container limitation becomes a
 * confirmation risk rather than a second, contradictory veto after export.
 */
export const outputVerificationCapabilitiesByFormat = {
  mp3: {
    probe: {
      acceptedContainerNames: ['mp3'],
      expectedAudioCodec: 'mp3',
      audioCodecReadback: 'when-transcoded',
    },
    standardMetadata: {
      reader: 'music-metadata-common',
      multiValueSeparator: ' / ',
    },
    covers: {
      write: 'embedded',
      comparison: 'ordered-mime-size-kind',
      roleReadback: 'exact',
      embeddableMimes: allAcceptedCoverMimes,
      allowUnmappedSourceVisualStreamCopy: false,
    },
    rawTags: {
      readback: 'same-container-only',
      crossContainerDescription: crossContainerRawTagDescription,
    },
  },
  m4a: {
    probe: {
      acceptedContainerNames: ['m4a', 'mp4', 'mov'],
      expectedAudioCodec: 'aac',
      audioCodecReadback: 'when-transcoded',
    },
    standardMetadata: {
      reader: 'music-metadata-common',
      multiValueSeparator: ' / ',
    },
    covers: {
      write: 'embedded',
      comparison: 'unordered-mime-size',
      roleReadback: 'implicit-front-when-single',
      embeddableMimes: m4aCoverMimes,
      allowUnmappedSourceVisualStreamCopy: false,
      omissionDescription:
        '当前 M4A MOV/iPod 写入路径只能以 covr 嵌入 PNG、JPG/JPEG；GIF 和 WebP 将从新副本省略。',
      roleDowngradeDescription:
        'M4A covr 不保存 ID3 风格的封面角色或顺序；会保留可嵌入图片集合，但角色与顺序将降级。',
    },
    rawTags: {
      readback: 'same-container-only',
      crossContainerDescription: crossContainerRawTagDescription,
    },
  },
  aac: {
    probe: {
      acceptedContainerNames: ['aac', 'adts'],
      expectedAudioCodec: 'aac',
      audioCodecReadback: 'always',
    },
    standardMetadata: {
      reader: 'ffprobe-format-tags',
      multiValueSeparator: ' / ',
    },
    covers: {
      write: 'omitted',
      comparison: 'must-be-empty',
      roleReadback: 'unavailable',
      embeddableMimes: [],
      allowUnmappedSourceVisualStreamCopy: false,
      omissionDescription:
        '首发 AAC 输出使用 ADTS .aac，不能承载内嵌封面；这些封面将从新副本省略。',
    },
    rawTags: {
      readback: 'same-container-only',
      crossContainerDescription: crossContainerRawTagDescription,
    },
  },
} as const satisfies Readonly<Record<BrowserOutputFormat, OutputVerificationCapability>>

export const outputVerificationCapabilityFor = (
  format: BrowserOutputFormat,
): OutputVerificationCapability => outputVerificationCapabilitiesByFormat[format]

export const normalizeOutputCoverMime = (mime: string): string =>
  mime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mime.toLowerCase()

export const isCoverEmbeddableInOutput = (
  format: BrowserOutputFormat,
  cover: Pick<CoverArtwork, 'mime'>,
): boolean => {
  const capability = outputVerificationCapabilityFor(format).covers
  return (
    capability.write === 'embedded' &&
    capability.embeddableMimes.includes(normalizeOutputCoverMime(cover.mime))
  )
}

export const coversOmittedByOutput = <T extends Pick<CoverArtwork, 'mime'>>(
  format: BrowserOutputFormat,
  covers: readonly T[],
): readonly T[] => covers.filter((cover) => !isCoverEmbeddableInOutput(format, cover))

/**
 * A single front image is the only role M4A can safely treat as implicit.
 * Empty artwork has no role semantics to downgrade.
 */
export const outputDropsCoverRoleSemantics = (
  format: BrowserOutputFormat,
  covers: readonly Pick<CoverArtwork, 'kind'>[],
): boolean => {
  const roleReadback = outputVerificationCapabilityFor(format).covers.roleReadback
  if (roleReadback === 'exact' || covers.length === 0) return false
  if (roleReadback === 'implicit-front-when-single') {
    return covers.length !== 1 || covers[0]?.kind !== 'front'
  }
  return true
}

export const shouldVerifyRawTagsExactly = (
  format: BrowserOutputFormat,
  requiresTranscode: boolean,
): boolean => {
  const readback = outputVerificationCapabilityFor(format).rawTags.readback
  return readback === 'always' || (readback === 'same-container-only' && !requiresTranscode)
}

export const shouldVerifyOutputAudioCodec = (
  format: BrowserOutputFormat,
  requiresTranscode: boolean,
): boolean => {
  const readback = outputVerificationCapabilityFor(format).probe.audioCodecReadback
  return readback === 'always' || (readback === 'when-transcoded' && requiresTranscode)
}
