import {
  defaultOutputBaseName,
  formatOutputFileName,
  getExtension,
  getRequestedOutputExtension,
  getResolvedFormat,
} from '@/domain/format'
import { parseLyricsPreview } from '@/domain/lrc'
import { lyricsFormatLimitations } from '@/domain/lyrics'
import {
  changedRawTags,
  findRawTagConflicts,
  rawTagEditSafetyIssue,
  standardFieldRawTagSafetyIssue,
} from './metadata-diff'
import {
  isOpaquePrivateNativeTag,
  isManagedLyricsSourceTag,
  isSynchronisedLyricsSourceTag,
} from './audio-metadata-reader'
import { mappableSurvivingCovers, survivingCovers } from './ffmpeg-arguments'
import {
  coversOmittedByOutput,
  isCoverEmbeddableInOutput,
  outputDropsCoverRoleSemantics,
  outputVerificationCapabilityFor,
  shouldVerifyRawTagsExactly,
} from '@/domain/output-verification-capabilities'
import type {
  ExportPlan,
  ExportRequest,
  ExportRisk,
  QueueItem,
  RuntimeStatus,
  StableOutputFormat,
} from '@/domain/model'

const risk = (
  id: ExportRisk['id'],
  kind: ExportRisk['kind'],
  title: string,
  description: string,
  requiresConfirmation = false,
): ExportRisk => ({ id, kind, title, description, requiresConfirmation })

const sourceFormat = (item: QueueItem): StableOutputFormat | null => {
  const container = item.technical?.container.toLowerCase() ?? ''
  const containerNames = container.split(',').map((name) => name.trim())
  if (containerNames.includes('mp3')) return 'mp3'
  if (
    containerNames.some(
      (name) => ['m4a', 'mp4', 'mov', 'mpeg-4'].includes(name) || name.includes('isom'),
    )
  ) {
    return 'm4a'
  }
  if (
    containerNames.some((name) => name === 'aac' || name === 'adts' || name.includes('adts'))
  ) {
    return 'aac'
  }

  const codec = item.technical?.codec.toLowerCase() ?? ''
  if (containerNames.some((name) => name === 'mpeg' || name.includes('mpeg audio'))) {
    return codec === 'mp3' || codec.includes('layer 3') ? 'mp3' : null
  }

  // An extension is only a selection hint. Browser export becomes eligible
  // after a parser/FFprobe result identifies a supported container and codec.
  return null
}

const hasMeaningfulMetadata = (item: QueueItem): boolean => {
  const { draft } = item
  return Boolean(
    draft.title ||
    draft.artists.length ||
    draft.album ||
    draft.albumArtists.length ||
    draft.genres.length ||
    draft.releaseDate ||
    draft.comment ||
    draft.trackNo ||
    draft.discNo ||
    draft.composers.length ||
    draft.lyricsSlots.some((slot) => Boolean(slot.text)) ||
    draft.covers.length ||
    draft.rawTags.length,
  )
}

export const buildExportPlan = (
  item: QueueItem,
  request: ExportRequest,
  runtime: RuntimeStatus,
): ExportPlan => {
  const source = sourceFormat(item)
  const resolved = request.format === 'original' ? source : getResolvedFormat(request.format)
  const requestedExtension =
    request.format === 'original'
      ? (source ?? getRequestedOutputExtension(request, item.identity.name))
      : getRequestedOutputExtension(request, item.identity.name)
  const outputBaseName = request.outputBaseName || defaultOutputBaseName(item.identity.name)
  const outputFileName = formatOutputFileName(outputBaseName, requestedExtension ?? 'audio')
  const risks: ExportRisk[] = []
  const requiresTranscode = Boolean(resolved && (!source || source !== resolved))
  const outputVerification = resolved ? outputVerificationCapabilityFor(resolved) : null
  const hasSynchronisedLyrics = item.nativeTags.some(isSynchronisedLyricsSourceTag)
  const hasUnverifiedNativeMetadata = item.nativeTags.some(
    (tag) => !isOpaquePrivateNativeTag(tag),
  )
  const replacesImportedLyrics =
    item.originalDraft.lyricsSlots.length > 0 || item.nativeTags.some(isManagedLyricsSourceTag)
  const rawTagConflicts = findRawTagConflicts(item.draft, item.originalDraft)
  const rawTagSafetyIssue = rawTagEditSafetyIssue(
    item.draft.rawTags,
    item.originalDraft.rawTags,
  )
  const standardFieldRawTagSafetyIssueMessage = standardFieldRawTagSafetyIssue(
    item.draft,
    item.originalDraft,
  )
  const retainedCovers = survivingCovers(item.draft, item.originalDraft)
  const mappableCovers = mappableSurvivingCovers(item.draft, item.originalDraft)
  const outputOmittedCovers = resolved ? coversOmittedByOutput(resolved, mappableCovers) : []
  const outputCovers = resolved
    ? mappableCovers.filter((cover) => isCoverEmbeddableInOutput(resolved, cover))
    : []
  const dropsCoverRoleSemantics = resolved
    ? outputDropsCoverRoleSemantics(resolved, outputCovers)
    : false
  const hasUnmappedEmbeddedCover = retainedCovers.some(
    (cover) => cover.source === 'embedded' && cover.sourceIndex === undefined,
  )
  const hasChangedRawTags =
    changedRawTags(item.draft.rawTags, item.originalDraft.rawTags).length > 0
  const browserExportWarning = item.browserExportWarning
  const lyricsTargetLimitations = resolved
    ? lyricsFormatLimitations(resolved, item.draft.lyricsSlots)
    : []

  if (!source) {
    risks.push(
      risk(
        'unsupported-source',
        'metadata-write',
        '输入格式不在已验证浏览器矩阵中',
        `当前探测结果为 ${item.technical?.container ?? `.${getExtension(item.identity.name) || '未知'}`}。已选目标会以重新编码方式尝试生成新副本，但输入标签、封面和音频兼容性不在首发承诺范围内。`,
        Boolean(resolved),
      ),
    )
  }

  if (!resolved) {
    const requestedLabel = requestedExtension ? `.${requestedExtension}` : '当前请求'
    risks.push(
      risk(
        'unsupported-target',
        'metadata-write',
        '目标格式尚未获得浏览器支持',
        `${requestedLabel} 可用于生成本机 FFmpeg 脚本，但首发浏览器稳定目标只有 MP3、M4A 与 AAC。`,
      ),
    )
  }

  if (requiresTranscode) {
    risks.push(
      risk(
        'transcode',
        'transcode',
        '将重新编码音频',
        '格式转换会创建新编码音频。采样率和声道会尽量保持，目标无法表达时会在执行前再次说明。',
        true,
      ),
    )
  }

  if (source === 'm4a' && item.technical?.lossless && resolved === 'mp3') {
    risks.push(
      risk(
        'lossless-to-lossy',
        'transcode',
        '无损音频将转换为有损 MP3',
        '当前 M4A 被探测为无损音频。导出 MP3 不可逆。',
        true,
      ),
    )
  }

  if (dropsCoverRoleSemantics && outputVerification?.covers.roleDowngradeDescription) {
    risks.push(
      risk(
        'cover-roles',
        'cover-type',
        '封面角色与顺序将降级',
        outputVerification.covers.roleDowngradeDescription,
        true,
      ),
    )
  }

  if (outputOmittedCovers.length > 0 && outputVerification?.covers.omissionDescription) {
    risks.push(
      risk(
        'cover-omitted',
        'cover-capacity',
        '部分封面将从新副本省略',
        `${outputVerification.covers.omissionDescription} 当前计划会省略 ${outputOmittedCovers
          .map((cover) => `${cover.kind}（${cover.mime}）`)
          .join('、')}。确认后仍会生成新副本；源文件不变。`,
        true,
      ),
    )
  }

  const timedLyricsLanguages = item.draft.lyricsSlots
    .filter((slot) => slot.text && parseLyricsPreview(slot.text).mode !== 'plain')
    .map((slot) => slot.language)
  if (timedLyricsLanguages.length > 0) {
    risks.push(
      risk(
        'lrc-as-text',
        'lyrics-structure',
        '时间标签歌词将作为普通歌词原文写入',
        `首发浏览器路径保留 ${timedLyricsLanguages.join('、')} 槽位的 LRC 原文，但不生成结构化 SYLT；支持同步歌词的播放器可能不会把它识别为同步歌词。`,
        true,
      ),
    )
  }

  if (
    replacesImportedLyrics ||
    item.draft.lyricsSlots.length > 1 ||
    lyricsTargetLimitations.length > 0
  ) {
    const limitations = lyricsTargetLimitations
      .map((limitation) => {
        const languages = limitation.languages.length
          ? `（${limitation.languages.join('、')}）`
          : ''
        return `${limitation.description}${languages}`
      })
      .join(' ')
    risks.push(
      risk(
        'lyrics-slot-compatibility',
        'lyrics-structure',
        lyricsTargetLimitations.length > 0
          ? '目标格式无法完整保留歌词槽位'
          : '歌词槽位会完整替换已识别的源歌词',
        `当前草稿有 ${item.draft.lyricsSlots.length} 个歌词语言槽位。导出会请求清除已识别的源歌词标签或帧，并按照所选目标的歌词字段配置写入可表达内容。${limitations ? ` ${limitations}` : ''} 已删除或目标无法表达的语言不会被伪装成完整保留；确认后仍会生成新的副本。`,
        true,
      ),
    )
  }

  if (hasSynchronisedLyrics) {
    risks.push(
      risk(
        'sylt-copy-uncertain',
        'lyrics-structure',
        '检测到同步歌词帧（SYLT）',
        'MINFO 不生成新的 SYLT。导出会清除这个已识别的同步帧，并仅以当前歌词槽位的普通歌词为准；LRC 时间标签会作为原文保留。',
        true,
      ),
    )
  }

  if (rawTagConflicts.length > 0) {
    risks.push(
      risk(
        'raw-tag-conflict',
        'metadata-write',
        '标准字段与原始标签存在冲突',
        `通用写入器会按导出参数写入 ${rawTagConflicts.map((conflict) => `${conflict.fieldLabel} / ${conflict.tagKey}`).join('、')}；副本中的最终槽位值或顺序可能与两处编辑之一不同。可先手动统一，也可确认后继续。`,
        true,
      ),
    )
  }

  if (rawTagSafetyIssue) {
    risks.push(
      risk(
        'raw-tag-duplicate-slot',
        'metadata-write',
        '高级标签含有无法精确单项修改的重复槽位',
        rawTagSafetyIssue,
        true,
      ),
    )
  }

  if (standardFieldRawTagSafetyIssueMessage) {
    risks.push(
      risk(
        'standard-field-duplicate-slot',
        'metadata-write',
        '标准字段会影响重复的高级标签槽位',
        standardFieldRawTagSafetyIssueMessage,
        true,
      ),
    )
  }

  if (hasUnmappedEmbeddedCover) {
    risks.push(
      risk(
        'unmapped-cover-omitted',
        'metadata-write',
        '部分原始封面无法映射到容器流',
        '浏览器无法确认这些封面对应哪个容器流。确认后会从新副本省略无法映射的封面，避免错配或错误替换；源文件不变。',
        true,
      ),
    )
  }

  if (
    resolved &&
    hasChangedRawTags &&
    !shouldVerifyRawTagsExactly(resolved, requiresTranscode) &&
    outputVerification?.rawTags.crossContainerDescription
  ) {
    risks.push(
      risk(
        'raw-tag-cross-container-best-effort',
        'metadata-write',
        '高级标签无法按原生键逐项回读',
        outputVerification.rawTags.crossContainerDescription,
        true,
      ),
    )
  }

  if (browserExportWarning) {
    risks.push(
      risk(
        'probe-incomplete',
        'metadata-write',
        '输入媒体未完成 FFprobe 交叉检查',
        `${browserExportWarning} 确认后仍会尝试生成新副本；只有输出容器和音频流通过完整性验证才会下载。`,
        true,
      ),
    )
  }

  if (requiresTranscode && hasUnverifiedNativeMetadata) {
    risks.push(
      risk(
        'unknown-tag-mapping',
        'metadata-write',
        '跨容器转换可能无法保留容器特定标签',
        '标题、艺术家等标准字段会进入目标映射；未编辑的未知或容器特定原始标签可能被目标转换器省略或重写，MINFO 不承诺其逐键保留。',
        true,
      ),
    )
  }

  if (runtime.state !== 'ready') {
    risks.push(
      risk(
        'runtime-unavailable',
        'runtime-unavailable',
        '浏览器媒体运行时尚未就绪',
        runtime.message,
      ),
    )
  }

  // A browser export always creates a new file. Lossy or unverifiable metadata
  // is therefore a confirmation gate, not an execution blocker. Only the lack
  // of a concrete browser target or runtime makes the plan impossible to run.
  const runnable = Boolean(resolved && runtime.state === 'ready')
  const requestedFormat =
    request.format === 'original' ? (source ?? 'original') : request.format
  const summary = !resolved
    ? '当前请求没有可执行的浏览器输出目标。请选择 MP3、M4A 或 AAC，或复制本机 FFmpeg 命令。'
    : runtime.state !== 'ready'
      ? '浏览器导出需要由 pnpm 锁定且已校验完整性的本地媒体运行时。可先继续编辑或复制同一份本机 FFmpeg 计划。'
      : risks.some((item) => item.requiresConfirmation)
        ? `检测到 ${risks.filter((item) => item.requiresConfirmation).length} 项副本影响；勾选“我已知晓，坚持导出”后可继续。`
        : requiresTranscode
          ? `将转换为 ${resolved.toUpperCase()} 并应用 ${request.quality} 预设。`
          : '将以流复制方式写入元信息，不重新编码音频。'

  return {
    sourceIdentity: item.identity,
    draftRevision: item.draftRevision,
    format: request.format,
    requestedExtension,
    resolvedFormat: resolved,
    outputFileName,
    quality: request.quality,
    requiresTranscode,
    engine: runtime.state === 'ready' ? 'browser-runtime' : 'local-ffmpeg',
    runnable,
    summary: `${requestedFormat.toUpperCase()}: ${summary}`,
    risks,
    runtimeVersion: runtime.version,
  }
}

export const needsConfirmation = (plan: ExportPlan): boolean =>
  plan.risks.some((item) => item.requiresConfirmation)

export const isMeaningfulExport = (item: QueueItem): boolean => hasMeaningfulMetadata(item)

/** A stable confirmation/export token for every user-visible plan input. */
export const exportPlanFingerprint = (plan: ExportPlan): string =>
  JSON.stringify({
    sourceIdentity: plan.sourceIdentity,
    draftRevision: plan.draftRevision,
    format: plan.format,
    requestedExtension: plan.requestedExtension,
    resolvedFormat: plan.resolvedFormat,
    outputFileName: plan.outputFileName,
    quality: plan.quality,
    requiresTranscode: plan.requiresTranscode,
    engine: plan.engine,
    runnable: plan.runnable,
    runtimeVersion: plan.runtimeVersion,
    risks: plan.risks.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      description: item.description,
      requiresConfirmation: item.requiresConfirmation,
    })),
  })
