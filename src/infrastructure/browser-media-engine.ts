import { parseBlob } from 'music-metadata'
import type { FFmpeg, LogEventCallback, ProgressEventCallback } from '@ffmpeg/ffmpeg'

import { buildFfmpegArguments, exportableCovers } from '@/application/ffmpeg-arguments'
import {
  lyricsInputSourceFromMetadata,
  managedLyricsNativeTagKeys,
  parseLyricsSlots,
} from '@/application/audio-metadata-reader'
import {
  changedRawTags,
  changedStandardFields,
  findRawTagConflicts,
  normalizedRawTagKey,
  standardFieldsWithDuplicateRawTagSlots,
  type StandardMetadataField,
} from '@/application/metadata-diff'
import { getBrowserAudioFormat } from '@/domain/audio-formats'
import { getExtension } from '@/domain/format'
import {
  lyricsVerificationMetadataKeysForFormat,
  normalizeLyricsSlots,
  ordinaryLyricsMetadataTagsForFormat,
  verifiesParsedLyricsLanguageManifest,
} from '@/domain/lyrics'
import type {
  CoverArtwork,
  ExportPlan,
  LyricsSlot,
  MediaProbeDiagnostic,
  MetadataDraft,
  NativeTag,
  RuntimeStatus,
  StableOutputFormat,
} from '@/domain/model'

import { debugMediaLog, isExpectedMuxingQueueDelay, type MediaTool } from './media-debug'
import {
  parseVerifiedFfprobeResult,
  primaryAudioCodec,
  streamsOf,
  type FfprobeDocument,
} from './ffprobe-result'
import { prepareMediaRuntime, type PreparedMediaRuntime } from './media-runtime-cache'

export interface MediaExportProgress {
  readonly ratio: number
  readonly stage: 'preparing' | 'processing' | 'verifying'
}

export interface BrowserExportRequest {
  readonly source: File
  readonly plan: ExportPlan
  readonly draft: MetadataDraft
  readonly originalDraft: MetadataDraft
  /** Exact source tag identifiers for lyrics that are managed by the form. */
  readonly nativeTags?: readonly NativeTag[]
  readonly onProgress?: (progress: MediaExportProgress) => void
}

export interface BrowserExportResult {
  readonly blob: Blob
  readonly fileName: string
}

/** `attachedPictureStreamIndices` are video-stream ordinals for `0:v:N`. */
export interface MediaProbeResult {
  readonly warning?: string
  readonly diagnostic?: MediaProbeDiagnostic
  readonly attachedPictureStreamIndices?: readonly number[]
  readonly container?: string
  readonly audioCodec?: string
}

const initialRuntimeStatus: RuntimeStatus = {
  state: 'preparing',
  version: 'loading',
  message: '正在准备由 pnpm 锁定且已校验完整性的本地媒体运行时。',
}

const stoppedRuntimeStatus: RuntimeStatus = {
  state: 'unavailable',
  version: 'stopped',
  message: '媒体运行时已停止。可重新准备后继续。',
}

const diagnosticLogLineLimit = 12
const diagnosticLogCharacterLimit = 600

interface ToolLogCapture {
  readonly lines: readonly string[]
  detach(): void
}

const mimeFor = (format: StableOutputFormat): string => getBrowserAudioFormat(format).mimeType

const extensionForCover = (mime: string): string => {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    default:
      return 'image'
  }
}

const safeExtension = (fileName: string, fallback: string): string => {
  const extension = getExtension(fileName)
  return /^[a-z0-9]{1,16}$/.test(extension) ? extension : fallback
}

const toBytes = (value: Uint8Array | string): Uint8Array =>
  typeof value === 'string' ? new TextEncoder().encode(value) : value

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer

const normalizeText = (value: string): string => value.replace(/\r\n?/g, '\n')

const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')

const stripAnsi = (value: string): string => value.replace(ansiEscapePattern, '')

const readableError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim().slice(0, diagnosticLogCharacterLimit) || '发生未知错误。'
}

const appendDiagnosticLogLines = (lines: string[], stream: string, message: string): void => {
  for (const rawLine of stripAnsi(message).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    lines.push(`[${stream}] ${line.slice(0, diagnosticLogCharacterLimit)}`)
  }
  if (lines.length > diagnosticLogLineLimit) {
    lines.splice(0, lines.length - diagnosticLogLineLimit)
  }
}

const equalLists = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index])

const equalMetadataLists = (actual: readonly string[], expected: readonly string[]): boolean =>
  equalLists(actual, expected) ||
  (actual.length === 1 && expected.length > 1 && actual[0] === expected.join(' / '))

const sameNumber = (actual: number | null | undefined, expected: string): boolean =>
  expected ? actual === Number(expected) : actual === null || actual === undefined

const nativeTagText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const normalizedMime = (mime: string): string =>
  mime === 'image/jpg' ? 'image/jpeg' : mime.toLowerCase()

const coverKind = (type: string | undefined): CoverArtwork['kind'] => {
  const normalized = type?.toLowerCase() ?? ''
  if (normalized.includes('back')) return 'back'
  if (normalized.includes('disc') || normalized.includes('media')) return 'disc'
  if (normalized.includes('artist') || normalized.includes('performer')) return 'artist'
  if (normalized.includes('front') || normalized.includes('cover')) return 'front'
  return 'other'
}

const assertCovers = (
  actual: readonly {
    readonly format?: string
    readonly data: Uint8Array
    readonly type?: string
  }[],
  expected: readonly CoverArtwork[],
  allowRoleDowngrade = false,
): void => {
  if (actual.length !== expected.length) {
    throw new Error('导出后的封面数量未通过回读验证，已取消下载。')
  }

  if (allowRoleDowngrade) {
    const unmatched = [...actual]
    const missing = expected.find((cover) => {
      const index = unmatched.findIndex(
        (output) =>
          normalizedMime(output.format ?? '') === normalizedMime(cover.mime) &&
          output.data.byteLength === cover.size,
      )
      if (index < 0) return true
      unmatched.splice(index, 1)
      return false
    })
    if (missing) {
      throw new Error(`导出后的封面“${missing.kind}”未通过内容回读验证，已取消下载。`)
    }
    return
  }

  const invalid = expected.find((cover, index) => {
    const output = actual[index]
    if (!output) return true
    return (
      normalizedMime(output.format ?? '') !== normalizedMime(cover.mime) ||
      output.data.byteLength !== cover.size ||
      coverKind(output.type) !== cover.kind
    )
  })
  if (invalid) {
    throw new Error(
      `导出后的封面“${invalid.kind}”未通过顺序、类型或字节大小回读验证，已取消下载。`,
    )
  }
}

const hasPlanRisk = (plan: ExportPlan, riskId: string): boolean =>
  plan.risks.some((risk) => risk.id === riskId)

/**
 * When the user explicitly accepts an unverified input boundary, the output
 * must still be a valid target container with an audio stream, but metadata
 * parsing cannot be used as a delivery veto.
 */
export const requiresFullMetadataReadback = (plan: ExportPlan): boolean =>
  !hasPlanRisk(plan, 'unsupported-source') && !hasPlanRisk(plan, 'probe-incomplete')

/**
 * A confirmation makes an ambiguous raw-tag change eligible for a new-copy
 * export, but it does not make its individual slots verifiable. Keep checking
 * every other raw tag so this exception is as narrow as possible.
 */
const unverifiedRawTagKeys = (
  plan: ExportPlan,
  draft: MetadataDraft,
  original: MetadataDraft,
): ReadonlySet<string> => {
  if (hasPlanRisk(plan, 'raw-tag-duplicate-slot')) {
    return new Set(
      changedRawTags(draft.rawTags, original.rawTags).map((change) =>
        normalizedRawTagKey(change.key),
      ),
    )
  }
  if (hasPlanRisk(plan, 'raw-tag-conflict')) {
    return new Set(
      findRawTagConflicts(draft, original).map((conflict) =>
        normalizedRawTagKey(conflict.tagKey),
      ),
    )
  }
  return new Set()
}

const assertRawTags = (
  native: Readonly<Record<string, readonly { readonly id: string; readonly value: unknown }[]>>,
  draft: MetadataDraft,
  original: MetadataDraft,
  unverifiedKeys: ReadonlySet<string>,
): void => {
  const allTags = Object.values(native).flat()
  for (const change of changedRawTags(draft.rawTags, original.rawTags)) {
    if (unverifiedKeys.has(normalizedRawTagKey(change.key))) continue
    const matchingValues = allTags
      .filter((tag) => tag.id.trim().toLowerCase() === change.key.trim().toLowerCase())
      .map((tag) => normalizeText(nativeTagText(tag.value)))
    const expected = normalizeText(change.value)
    const valid = expected
      ? matchingValues.some((value) => value === expected)
      : matchingValues.length === 0
    if (!valid) {
      throw new Error(`导出后的高级标签 ${change.key} 未通过回读验证，已取消下载。`)
    }
  }
}

const formatTagValue = (document: FfprobeDocument, key: string): string => {
  const match = Object.entries(document.format?.tags ?? {}).find(
    ([candidate]) => candidate.toLowerCase() === key.toLowerCase(),
  )
  return normalizeText(match?.[1] ?? '')
}

const trackText = (number: string, total: string): string =>
  number ? `${number}${total ? `/${total}` : ''}` : ''

/**
 * Duplicate raw slots have no stable generic-addressing model. Once the user
 * accepts that downgrade, retain validation for unrelated standard fields but
 * do not treat the ambiguous semantic field as a failed export.
 */
const verifiableStandardChanges = (
  draft: MetadataDraft,
  original: MetadataDraft,
): ReadonlySet<StandardMetadataField> => {
  const changed = new Set(changedStandardFields(draft, original))
  for (const field of standardFieldsWithDuplicateRawTagSlots(draft, original)) {
    changed.delete(field)
  }
  return changed
}

/**
 * music-metadata intentionally exposes only part of ADTS ID3v2 text through
 * its common model. FFprobe's structured format tags are the authoritative
 * round-trip evidence for MINFO's ADTS AAC output path.
 */
const assertAacMetadata = (
  document: FfprobeDocument,
  draft: MetadataDraft,
  original: MetadataDraft,
): void => {
  const changed = verifiableStandardChanges(draft, original)
  const checks: readonly [boolean, string][] = [
    [!changed.has('title') || formatTagValue(document, 'title') === draft.title, '标题'],
    [
      !changed.has('artists') ||
        formatTagValue(document, 'artist') === draft.artists.join(' / '),
      '艺术家',
    ],
    [!changed.has('album') || formatTagValue(document, 'album') === draft.album, '专辑'],
    [
      !changed.has('albumArtists') ||
        formatTagValue(document, 'album_artist') === draft.albumArtists.join(' / '),
      '专辑艺术家',
    ],
    [
      !changed.has('genres') || formatTagValue(document, 'genre') === draft.genres.join(' / '),
      '流派',
    ],
    [
      !changed.has('releaseDate') || formatTagValue(document, 'date') === draft.releaseDate,
      '发行日期',
    ],
    [!changed.has('comment') || formatTagValue(document, 'comment') === draft.comment, '评论'],
    [
      !changed.has('track') ||
        formatTagValue(document, 'track') === trackText(draft.trackNo, draft.trackTotal),
      '曲目编号',
    ],
    [
      !changed.has('disc') ||
        formatTagValue(document, 'disc') === trackText(draft.discNo, draft.discTotal),
      '碟片编号',
    ],
    [
      !changed.has('composers') ||
        formatTagValue(document, 'composer') === draft.composers.join(' / '),
      '作曲者',
    ],
  ]
  const failed = checks.find(([valid]) => !valid)
  if (failed) {
    throw new Error(`导出后的 AAC ${failed[1]}未通过 FFprobe 回读验证，已取消下载。`)
  }
}

/**
 * The editable lyrics slots are the requested output manifest. FFprobe only
 * verifies fields the selected container configuration can actually express;
 * for example M4A verifies its primary `lyrics`/©lyr text but not ID3-style
 * language helpers or secondary language slots.
 */
export const assertOrdinaryLyricsReadback = (
  document: FfprobeDocument,
  format: StableOutputFormat,
  draft: MetadataDraft,
  original: MetadataDraft,
  managedLyricsSourceTagKeys: readonly string[] = [],
): void => {
  const expected = new Map(
    ordinaryLyricsMetadataTagsForFormat(format, draft.lyricsSlots).map((tag) => [
      tag.key,
      { value: tag.value, language: tag.language, primary: tag.primary },
    ]),
  )
  const keys = lyricsVerificationMetadataKeysForFormat(
    format,
    original.lyricsSlots,
    draft.lyricsSlots,
    managedLyricsSourceTagKeys,
  )
  if (keys.length === 0) return
  const checks: readonly [boolean, string][] = keys.map((key) => {
    const current = expected.get(key)
    const expectedValue = normalizeText(current?.value ?? '')
    const label =
      key === 'lyrics'
        ? '普通歌词'
        : key === 'lyrics_language'
          ? '歌词语言'
          : current
            ? `歌词槽位 ${current.language}`
            : `歌词标签 ${key}`
    return [formatTagValue(document, key) === expectedValue, label]
  })
  const failed = checks.find(([valid]) => !valid)
  if (failed) {
    throw new Error(`导出后的${failed[1]}未通过 FFprobe 回读验证，已取消下载。`)
  }
}

/**
 * FFprobe verifies the configured ordinary lyrics tags. Where the target can
 * reconstruct language-qualified slots, a second parser is only a veto when
 * it finds a language absent from the form; it otherwise skips this check.
 */
export const assertLyricsManifestReadback = (
  actualSlots: readonly LyricsSlot[],
  draft: MetadataDraft,
  format: StableOutputFormat,
): void => {
  if (!verifiesParsedLyricsLanguageManifest(format)) return
  const expectedLanguages = new Set(
    normalizeLyricsSlots(draft.lyricsSlots).map((slot) => slot.language),
  )
  const unexpectedLanguages = [
    ...new Set(
      normalizeLyricsSlots(actualSlots)
        .map((slot) => slot.language)
        .filter((language) => !expectedLanguages.has(language)),
    ),
  ]
  if (unexpectedLanguages.length === 0) return
  throw new Error(
    `导出后仍检测到当前表单之外的歌词语言（${unexpectedLanguages.join('、')}），已取消下载。`,
  )
}

const verifyMetadata = async (
  blob: Blob,
  probeDocument: FfprobeDocument,
  plan: ExportPlan,
  draft: MetadataDraft,
  original: MetadataDraft,
  format: StableOutputFormat,
  managedLyricsSourceTagKeys: readonly string[],
): Promise<void> => {
  const changed = verifiableStandardChanges(draft, original)
  const expectedCovers = exportableCovers(plan, draft, original)
  const metadata = await parseBlob(blob, { duration: false })
  const { common } = metadata
  const checks: readonly [boolean, string][] = [
    [!changed.has('title') || (common.title ?? '') === draft.title, '标题'],
    [
      !changed.has('artists') ||
        equalMetadataLists(
          common.artists ?? (common.artist ? [common.artist] : []),
          draft.artists,
        ),
      '艺术家',
    ],
    [!changed.has('album') || (common.album ?? '') === draft.album, '专辑'],
    [
      !changed.has('albumArtists') ||
        equalMetadataLists(
          common.albumartists ?? (common.albumartist ? [common.albumartist] : []),
          draft.albumArtists,
        ),
      '专辑艺术家',
    ],
    [!changed.has('genres') || equalMetadataLists(common.genre ?? [], draft.genres), '流派'],
    [
      !changed.has('releaseDate') ||
        (common.date ?? common.releasedate ?? common.year?.toString() ?? '') ===
          draft.releaseDate,
      '发行日期',
    ],
    [!changed.has('comment') || (common.comment?.[0]?.text ?? '') === draft.comment, '评论'],
    [
      !changed.has('track') ||
        (sameNumber(common.track.no, draft.trackNo) &&
          sameNumber(common.track.of, draft.trackTotal)),
      '曲目编号',
    ],
    [
      !changed.has('disc') ||
        (sameNumber(common.disk.no, draft.discNo) &&
          sameNumber(common.disk.of, draft.discTotal)),
      '碟片编号',
    ],
    [
      !changed.has('composers') || equalMetadataLists(common.composer ?? [], draft.composers),
      '作曲者',
    ],
  ]
  const failed = (format === 'aac' ? [] : checks).find(([valid]) => !valid)
  if (failed) {
    throw new Error(`导出后的${failed[1]}未通过回读验证，已取消下载。`)
  }

  assertOrdinaryLyricsReadback(
    probeDocument,
    format,
    draft,
    original,
    managedLyricsSourceTagKeys,
  )
  assertLyricsManifestReadback(
    parseLyricsSlots(
      metadata.common.lyrics,
      metadata.native,
      lyricsInputSourceFromMetadata(metadata),
    ).slots,
    draft,
    format,
  )
  assertCovers(common.picture ?? [], expectedCovers, hasPlanRisk(plan, 'cover-roles'))
  assertRawTags(metadata.native, draft, original, unverifiedRawTagKeys(plan, draft, original))
}

const probeArguments = (sourcePath: string, resultPath: string): string[] => [
  '-v',
  'error',
  '-show_format',
  '-show_streams',
  '-of',
  'json',
  sourcePath,
  '-o',
  resultPath,
]

const attachedPictureOrdinals = (document: FfprobeDocument): readonly number[] => {
  let videoOrdinal = 0
  const result: number[] = []
  for (const stream of streamsOf(document)) {
    if (stream.codec_type !== 'video') continue
    if (stream.disposition?.attached_pic === 1) result.push(videoOrdinal)
    videoOrdinal += 1
  }
  return result
}

const assertOutputProbe = (plan: ExportPlan, document: FfprobeDocument): void => {
  const containerNames = (document.format?.format_name ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  const codec = primaryAudioCodec(document)
  if (!codec) throw new Error('导出文件未通过 FFprobe 音频流验证。')

  const matchesContainer =
    plan.resolvedFormat === 'mp3'
      ? containerNames.includes('mp3')
      : plan.resolvedFormat === 'm4a'
        ? containerNames.some((name) => ['m4a', 'mp4', 'mov'].includes(name))
        : containerNames.some((name) => name === 'aac' || name === 'adts')
  if (!matchesContainer) {
    throw new Error('导出文件的容器与预检目标不一致，已取消下载。')
  }

  if (plan.requiresTranscode || plan.resolvedFormat === 'aac') {
    const expectedCodec = plan.resolvedFormat === 'mp3' ? 'mp3' : 'aac'
    if (codec !== expectedCodec) {
      throw new Error('导出文件的音频编码与预检目标不一致，已取消下载。')
    }
  }
}

export class BrowserMediaEngine {
  #status: RuntimeStatus = initialRuntimeStatus
  #ffmpeg: FFmpeg | null = null
  #assets: PreparedMediaRuntime | null = null
  #preparing: Promise<RuntimeStatus> | null = null
  #lifecycle = 0
  #operationNumber = 0
  #operationTail: Promise<void> = Promise.resolve()

  get status(): RuntimeStatus {
    return this.#status
  }

  async prepare(onStatus?: (status: RuntimeStatus) => void): Promise<RuntimeStatus> {
    if (this.#status.state === 'ready' && this.#ffmpeg) return this.#status
    if (this.#preparing) return this.#preparing

    this.#status = initialRuntimeStatus
    onStatus?.(this.#status)
    const lifecycle = ++this.#lifecycle
    const preparing = this.#load(lifecycle, onStatus)
    this.#preparing = preparing
    try {
      return await preparing
    } finally {
      if (this.#preparing === preparing) this.#preparing = null
    }
  }

  async probe(file: File): Promise<MediaProbeResult> {
    return this.#withExclusiveOperation(async () => {
      const ffmpeg = this.#ffmpeg
      if (!ffmpeg || this.#status.state !== 'ready') {
        const warning = '媒体运行时尚未就绪，未执行 FFprobe 交叉检查。'
        return {
          warning,
          diagnostic: {
            stage: 'runtime',
            summary: this.#status.message,
            logLines: [],
          },
        }
      }

      const operation = this.#nextOperationName('probe')
      const sourcePath = `${operation}-input.${safeExtension(file.name, 'audio')}`
      const resultPath = `${operation}-result.json`
      const logs = this.#captureToolLogs(ffmpeg, 'ffprobe')
      let stage: MediaProbeDiagnostic['stage'] = 'input'
      let exitCode: number | undefined
      try {
        await ffmpeg.writeFile(sourcePath, new Uint8Array(await file.arrayBuffer()))
        stage = 'ffprobe'
        exitCode = await ffmpeg.ffprobe(probeArguments(sourcePath, resultPath))
        stage = 'output'
        const result = parseVerifiedFfprobeResult(exitCode, await ffmpeg.readFile(resultPath))
        if (result.hasAdvisoryExitCode) {
          debugMediaLog(
            'ffprobe',
            'compatibility',
            'FFprobe returned -1, but its generated JSON verified the container and audio stream.',
          )
        }
        return {
          attachedPictureStreamIndices: attachedPictureOrdinals(result.document),
          container: result.container,
          audioCodec: result.audioCodec,
        }
      } catch (error) {
        return {
          warning: 'FFprobe 交叉检查失败，但表单草稿已保留。',
          diagnostic: {
            stage,
            summary: readableError(error),
            ...(exitCode === undefined ? {} : { exitCode }),
            logLines: logs.lines,
          },
        }
      } finally {
        logs.detach()
        await this.#deleteFiles(ffmpeg, [sourcePath, resultPath])
      }
    })
  }

  async #load(
    lifecycle: number,
    onStatus?: (status: RuntimeStatus) => void,
  ): Promise<RuntimeStatus> {
    let assets: PreparedMediaRuntime | null = null
    let ffmpeg: FFmpeg | null = null
    let logs: ToolLogCapture | null = null
    try {
      assets = await prepareMediaRuntime()
      if (!this.#isCurrent(lifecycle)) {
        assets.revoke()
        return this.#status
      }

      const coreURL = assets.urls.core
      const wasmURL = assets.urls.wasm
      if (!coreURL || !wasmURL) throw new Error('媒体运行时缺少可加载的 core 或 wasm URL。')

      const { FFmpeg } = await import('@ffmpeg/ffmpeg')
      ffmpeg = new FFmpeg()
      logs = this.#captureToolLogs(ffmpeg, 'ffmpeg')
      const workerURL = assets.urls.worker
      await ffmpeg.load({ coreURL, wasmURL, ...(workerURL ? { workerURL } : {}) })
      const code = await ffmpeg.exec(['-version'])
      if (code !== 0) throw new Error('媒体运行时自检失败。')
      if (!this.#isCurrent(lifecycle)) {
        ffmpeg.terminate()
        assets.revoke()
        return this.#status
      }

      this.#assets = assets
      this.#ffmpeg = ffmpeg
      this.#status = {
        state: 'ready',
        version: assets.manifest.runtimeVersion,
        message: `FFmpeg WASM ${assets.manifest.distribution?.coreVersion ?? '已验证'} 媒体运行时已就绪（底层 FFmpeg ${assets.manifest.distribution?.ffmpegVersion ?? '未知'}），资源来自${assets.source === 'opfs' ? ' OPFS 缓存' : '同源部署'}。`,
      }
    } catch (error) {
      ffmpeg?.terminate()
      assets?.revoke()
      if (this.#isCurrent(lifecycle)) {
        this.#status = {
          state: 'unavailable',
          version: 'unavailable',
          message:
            error instanceof Error
              ? `浏览器媒体运行时不可用：${error.message}`
              : '浏览器媒体运行时不可用。',
        }
      }
    } finally {
      logs?.detach()
    }

    if (this.#isCurrent(lifecycle)) onStatus?.(this.#status)
    return this.#status
  }

  async export(request: BrowserExportRequest): Promise<BrowserExportResult> {
    return this.#withExclusiveOperation(async () => {
      const ffmpeg = this.#ffmpeg
      if (!ffmpeg || this.#status.state !== 'ready') {
        throw new Error('浏览器媒体运行时尚未就绪。')
      }
      if (!request.plan.resolvedFormat) {
        throw new Error('当前导出格式不受浏览器运行时支持。')
      }

      const operation = this.#nextOperationName('export')
      const sourcePath = `${operation}-input.${safeExtension(request.source.name, 'audio')}`
      const outputPath = `${operation}-output.${request.plan.resolvedFormat}`
      const probePath = `${operation}-probe.json`
      const temporaryPaths = [sourcePath, outputPath, probePath]
      const replacementCovers = exportableCovers(
        request.plan,
        request.draft,
        request.originalDraft,
      ).filter((cover) => cover.source === 'replacement' && cover.file)
      const managedLyricsSourceTagKeys = managedLyricsNativeTagKeys(request.nativeTags ?? [])
      const onProgress: ProgressEventCallback = ({ progress }) => {
        request.onProgress?.({ ratio: Math.max(0, Math.min(progress, 1)), stage: 'processing' })
      }
      request.onProgress?.({ ratio: 0, stage: 'preparing' })

      try {
        await ffmpeg.writeFile(sourcePath, new Uint8Array(await request.source.arrayBuffer()))
        const coverPaths: string[] = []
        for (const [index, cover] of replacementCovers.entries()) {
          const path = `${operation}-cover-${index}.${extensionForCover(cover.mime)}`
          const coverFile = cover.file
          if (!coverFile) continue
          await ffmpeg.writeFile(path, new Uint8Array(await coverFile.arrayBuffer()))
          temporaryPaths.push(path)
          coverPaths.push(path)
        }

        ffmpeg.on('progress', onProgress)
        const code = await this.#runWithToolLogs(ffmpeg, 'ffmpeg', () =>
          ffmpeg.exec(
            buildFfmpegArguments(
              request.plan,
              request.draft,
              request.originalDraft,
              {
                source: sourcePath,
                covers: coverPaths,
                output: outputPath,
              },
              { managedLyricsSourceTagKeys },
            ),
          ),
        )
        if (code !== 0) throw new Error(`FFmpeg 以状态码 ${code} 结束。`)

        request.onProgress?.({ ratio: 1, stage: 'verifying' })
        const probeCode = await this.#runWithToolLogs(ffmpeg, 'ffprobe', () =>
          ffmpeg.ffprobe(probeArguments(outputPath, probePath)),
        )
        const probe = parseVerifiedFfprobeResult(probeCode, await ffmpeg.readFile(probePath))
        if (probe.hasAdvisoryExitCode) {
          debugMediaLog(
            'ffprobe',
            'compatibility',
            'FFprobe returned -1, but its generated JSON verified the exported container and audio stream.',
          )
        }
        assertOutputProbe(request.plan, probe.document)
        const validateMetadata = requiresFullMetadataReadback(request.plan)
        if (validateMetadata && request.plan.resolvedFormat === 'aac') {
          assertAacMetadata(probe.document, request.draft, request.originalDraft)
        }

        const data = toBytes(await ffmpeg.readFile(outputPath))
        const blob = new Blob([toArrayBuffer(data)], {
          type: mimeFor(request.plan.resolvedFormat),
        })
        if (validateMetadata) {
          await verifyMetadata(
            blob,
            probe.document,
            request.plan,
            request.draft,
            request.originalDraft,
            request.plan.resolvedFormat,
            managedLyricsSourceTagKeys,
          )
        }
        return { blob, fileName: request.plan.outputFileName }
      } finally {
        ffmpeg.off('progress', onProgress)
        await this.#deleteFiles(ffmpeg, temporaryPaths)
      }
    })
  }

  terminate(): void {
    this.#lifecycle += 1
    this.#preparing = null
    this.#ffmpeg?.terminate()
    this.#ffmpeg = null
    this.#assets?.revoke()
    this.#assets = null
    this.#status = stoppedRuntimeStatus
  }

  #isCurrent(lifecycle: number): boolean {
    return lifecycle === this.#lifecycle
  }

  #nextOperationName(kind: 'probe' | 'export'): string {
    this.#operationNumber += 1
    return `minfo-${kind}-${this.#operationNumber}`
  }

  #captureToolLogs(ffmpeg: FFmpeg, tool: MediaTool): ToolLogCapture {
    const lines: string[] = []
    const collapsedMessages = new Set<string>()
    const callback: LogEventCallback = ({ type, message }) => {
      const key = `${type}:${message.trim()}`
      if (isExpectedMuxingQueueDelay(tool, type, message)) {
        if (collapsedMessages.has(key)) return
        collapsedMessages.add(key)
        const summary = `${message.trim()}（后续相同的封装队列提示已折叠。）`
        debugMediaLog(tool, type, summary)
        appendDiagnosticLogLines(lines, type, summary)
        return
      }
      debugMediaLog(tool, type, message)
      appendDiagnosticLogLines(lines, type, message)
    }
    ffmpeg.on('log', callback)
    return {
      lines,
      detach: () => ffmpeg.off('log', callback),
    }
  }

  async #runWithToolLogs<T>(
    ffmpeg: FFmpeg,
    tool: MediaTool,
    task: () => Promise<T>,
  ): Promise<T> {
    const logs = this.#captureToolLogs(ffmpeg, tool)
    try {
      return await task()
    } finally {
      logs.detach()
    }
  }

  async #withExclusiveOperation<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail
    let release: (() => void) | undefined
    this.#operationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await task()
    } finally {
      release?.()
    }
  }

  async #deleteFiles(ffmpeg: FFmpeg, paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      try {
        await ffmpeg.deleteFile(path)
      } catch {
        // A cancelled worker or failed job may have removed the path already.
      }
    }
  }
}
