import type {
  AudioQualityPreset,
  CoverArtwork,
  ExportPlan,
  MetadataDraft,
  StableOutputFormat,
} from '@/domain/model'
import {
  lyricsManifestMetadataKeys,
  lyricsMetadataKeysToClearForFormat,
  ordinaryLyricsMetadataTags,
  ordinaryLyricsMetadataTagsForFormat,
} from '@/domain/lyrics'
import {
  isCoverEmbeddableInOutput,
  outputVerificationCapabilityFor,
} from '@/domain/output-verification-capabilities'

import {
  changedRawTags,
  changedStandardFields,
  type StandardMetadataField,
} from './metadata-diff'

export interface FfmpegInputPaths {
  readonly source: string
  readonly covers: readonly string[]
  readonly output: string
}

export interface FfmpegBuildOptions {
  /**
   * Local fallback only: retain all original visual streams when no individual
   * stream mapping is available but the user did not alter the cover layout.
   */
  readonly preserveAllSourceVideoStreams?: boolean
  /** Exact source lyrics identifiers that must be replaced by the slot manifest. */
  readonly managedLyricsSourceTagKeys?: readonly string[]
  /**
   * Browser targets use their configured lyrics field map. Omit only for the
   * arbitrary local-command path, which intentionally retains generic FFmpeg
   * metadata requests without a browser compatibility claim.
   */
  readonly lyricsFormat?: StableOutputFormat
  /**
   * Browser targets use the same output capability for multi-value metadata
   * serialization as they use for readback. Omit for arbitrary local formats.
   */
  readonly outputFormat?: StableOutputFormat
}

export interface QualityParameters {
  readonly encoder: string
  readonly arguments: readonly string[]
  readonly label: string
  readonly presetVersion: string
}

const presetVersion = '2026.1'

const mp3Quality: Record<AudioQualityPreset, QualityParameters> = {
  high: {
    encoder: 'libmp3lame',
    arguments: ['-q:a', '0'],
    label: 'V0 可变码率',
    presetVersion,
  },
  balanced: {
    encoder: 'libmp3lame',
    arguments: ['-q:a', '2'],
    label: 'V2 可变码率',
    presetVersion,
  },
  compact: {
    encoder: 'libmp3lame',
    arguments: ['-q:a', '5'],
    label: 'V5 可变码率',
    presetVersion,
  },
}

const aacQuality: Record<AudioQualityPreset, QualityParameters> = {
  high: {
    encoder: 'aac',
    arguments: ['-b:a', '256k'],
    label: '256 kbit/s',
    presetVersion,
  },
  balanced: {
    encoder: 'aac',
    arguments: ['-b:a', '192k'],
    label: '192 kbit/s',
    presetVersion,
  },
  compact: {
    encoder: 'aac',
    arguments: ['-b:a', '128k'],
    label: '128 kbit/s',
    presetVersion,
  },
}

export const qualityFor = (
  format: StableOutputFormat,
  quality: AudioQualityPreset,
): QualityParameters => (format === 'mp3' ? mp3Quality[quality] : aacQuality[quality])

const joined = (values: readonly string[], separator: string): string => values.join(separator)

const presentMetadata = (key: string, value: string): string[] => [
  '-metadata',
  `${key}=${value}`,
]

const ordinaryLyricsMetadataArguments = (
  draft: MetadataDraft,
  original: MetadataDraft,
  options: Pick<FfmpegBuildOptions, 'lyricsFormat' | 'managedLyricsSourceTagKeys'> = {},
): string[] => {
  const current = new Map(
    (options.lyricsFormat
      ? ordinaryLyricsMetadataTagsForFormat(options.lyricsFormat, draft.lyricsSlots)
      : ordinaryLyricsMetadataTags(draft.lyricsSlots)
    ).map((tag) => [tag.key, tag.value]),
  )
  const sourceKeys = new Set(
    options.lyricsFormat
      ? lyricsMetadataKeysToClearForFormat(
          options.lyricsFormat,
          original.lyricsSlots,
          draft.lyricsSlots,
          options.managedLyricsSourceTagKeys,
        )
      : [
          ...(options.managedLyricsSourceTagKeys ?? [])
            .map((key) => key.trim())
            .filter(Boolean),
          ...lyricsManifestMetadataKeys(original.lyricsSlots),
          ...lyricsManifestMetadataKeys(draft.lyricsSlots),
        ],
  )
  if (sourceKeys.size === 0) return []

  // Lyrics slots are the final export manifest, constrained by the selected
  // target capability. Clear only the aliases and ordinary keys that target
  // can express, then add only its configured current fields. Unsupported
  // fields remain an explicit preflight downgrade rather than fake writes.
  return [
    ...[...sourceKeys].flatMap((key) => presentMetadata(key, '')),
    ...[...current].flatMap(([key, value]) => presentMetadata(key, value)),
  ]
}

const standardMetadataArguments = (
  draft: MetadataDraft,
  original: MetadataDraft,
  outputFormat?: StableOutputFormat,
): string[] => {
  const multiValueSeparator = outputFormat
    ? outputVerificationCapabilityFor(outputFormat).standardMetadata.multiValueSeparator
    : ' / '
  const changed = changedStandardFields(draft, original)
  const track = draft.trackNo
    ? `${draft.trackNo}${draft.trackTotal ? `/${draft.trackTotal}` : ''}`
    : ''
  const disc = draft.discNo
    ? `${draft.discNo}${draft.discTotal ? `/${draft.discTotal}` : ''}`
    : ''

  const fields: readonly [StandardMetadataField, string, string][] = [
    ['title', 'title', draft.title],
    ['artists', 'artist', joined(draft.artists, multiValueSeparator)],
    ['album', 'album', draft.album],
    ['albumArtists', 'album_artist', joined(draft.albumArtists, multiValueSeparator)],
    ['genres', 'genre', joined(draft.genres, multiValueSeparator)],
    ['releaseDate', 'date', draft.releaseDate],
    ['comment', 'comment', draft.comment],
    ['track', 'track', track],
    ['disc', 'disc', disc],
    ['composers', 'composer', joined(draft.composers, multiValueSeparator)],
  ]

  return fields.flatMap(([field, key, value]) =>
    changed.has(field) ? presentMetadata(key, value) : [],
  )
}

const rawMetadataArguments = (draft: MetadataDraft, original: MetadataDraft): string[] =>
  changedRawTags(draft.rawTags, original.rawTags).flatMap((tag) =>
    tag.key.trim() ? presentMetadata(tag.key.trim(), tag.value.replaceAll('\u0000', '')) : [],
  )

const coverArguments = (covers: readonly CoverArtwork[]): string[] =>
  covers.flatMap((cover, index) => [
    '-metadata:s:v:' + index,
    `title=Artwork ${index + 1}`,
    '-metadata:s:v:' + index,
    `comment=Cover (${cover.kind})`,
    '-disposition:v:' + index,
    'attached_pic',
  ])

export const survivingCovers = (
  draft: MetadataDraft,
  originalDraft: MetadataDraft,
): readonly CoverArtwork[] => {
  const originalIds = new Set(originalDraft.covers.map((cover) => cover.id))
  const replacementTargets = new Set(
    draft.covers.map((cover) => cover.replacesId).filter((id): id is string => Boolean(id)),
  )
  return draft.covers.filter(
    (cover) =>
      cover.source === 'replacement' ||
      (originalIds.has(cover.id) && !replacementTargets.has(cover.id)),
  )
}

/**
 * Covers whose source stream or replacement file is addressable by the
 * browser FFmpeg invocation. Target-specific support is deliberately applied
 * later by `exportableCovers`, so the preflight can distinguish an unmapped
 * input cover from one the selected container cannot carry.
 */
export const mappableSurvivingCovers = (
  draft: MetadataDraft,
  originalDraft: MetadataDraft,
): readonly CoverArtwork[] =>
  survivingCovers(draft, originalDraft).filter(
    (cover) => cover.source === 'replacement' || cover.sourceIndex !== undefined,
  )

/**
 * Covers that the generic browser FFmpeg path can deliberately include in an
 * output copy. The output-verification capability is the single source for
 * target image support; unmapped source pictures are handled separately by the
 * export plan as a confirmation risk.
 */
export const exportableCovers = (
  plan: ExportPlan,
  draft: MetadataDraft,
  originalDraft: MetadataDraft,
): readonly CoverArtwork[] => {
  if (!plan.resolvedFormat) return []
  return mappableSurvivingCovers(draft, originalDraft).filter((cover) =>
    isCoverEmbeddableInOutput(plan.resolvedFormat!, cover),
  )
}

export const buildMetadataArguments = (
  draft: MetadataDraft,
  originalDraft: MetadataDraft,
  options: Pick<
    FfmpegBuildOptions,
    'lyricsFormat' | 'managedLyricsSourceTagKeys' | 'outputFormat'
  > = {},
): string[] => [
  ...rawMetadataArguments(draft, originalDraft),
  ...standardMetadataArguments(draft, originalDraft, options.outputFormat),
  ...ordinaryLyricsMetadataArguments(draft, originalDraft, options),
]

/**
 * Produces argv for the browser runtime or a local FFmpeg invocation. Inputs and
 * output are already logical file-system paths, never shell fragments.
 */
export const buildFfmpegArguments = (
  plan: ExportPlan,
  draft: MetadataDraft,
  originalDraft: MetadataDraft,
  paths: FfmpegInputPaths,
  options: FfmpegBuildOptions = {},
): string[] => {
  if (!plan.resolvedFormat) {
    throw new Error('当前导出计划没有可执行的浏览器目标格式。')
  }

  const covers = exportableCovers(plan, draft, originalDraft)
  const replacementCovers = covers.filter((cover) => cover.source === 'replacement')
  if (paths.covers.length < replacementCovers.length) {
    throw new Error('导出计划缺少要写入新副本的替换封面。')
  }
  const coverPaths = paths.covers.slice(0, replacementCovers.length)
  const preserveAllSourceVideoStreams = Boolean(
    options.preserveAllSourceVideoStreams &&
    outputVerificationCapabilityFor(plan.resolvedFormat).covers
      .allowUnmappedSourceVisualStreamCopy,
  )
  const args = ['-hide_banner', '-nostdin', '-i', paths.source]
  for (const cover of coverPaths) {
    args.push('-i', cover)
  }

  args.push('-map', '0:a:0', '-map_metadata', '0')
  if (preserveAllSourceVideoStreams) {
    args.push('-map', '0:v?')
  } else {
    let replacementIndex = 0
    covers.forEach((cover) => {
      if (cover.source === 'embedded' && cover.sourceIndex !== undefined) {
        // The media engine stores the attached picture's ordinal among video streams.
        args.push('-map', `0:v:${cover.sourceIndex}?`)
        return
      }

      args.push('-map', `${replacementIndex + 1}:v:0`)
      replacementIndex += 1
    })
  }

  if (plan.requiresTranscode) {
    const quality = qualityFor(plan.resolvedFormat, plan.quality)
    args.push('-c:a', quality.encoder, ...quality.arguments)
  } else {
    args.push('-c:a', 'copy')
  }

  if (covers.length > 0 && !preserveAllSourceVideoStreams) {
    args.push('-c:v', 'copy', ...coverArguments(covers))
  } else if (preserveAllSourceVideoStreams) {
    // Keeping all source video streams is only used by the local fallback when
    // their individual order is not proven. Do not attach per-stream metadata
    // based on an order we cannot verify.
    args.push('-c:v', 'copy')
  }

  if (plan.resolvedFormat === 'mp3' && plan.requiresTranscode) {
    args.push('-id3v2_version', '4', '-write_id3v1', '0')
  }
  if (plan.resolvedFormat === 'aac') {
    args.push('-f', 'adts', '-write_id3v2', '1')
  }

  args.push(
    ...buildMetadataArguments(draft, originalDraft, {
      ...options,
      lyricsFormat: plan.resolvedFormat,
      outputFormat: plan.resolvedFormat,
    }),
    paths.output,
  )
  return args
}
