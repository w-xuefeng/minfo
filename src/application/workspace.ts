import { computed, ref, type ComputedRef, type Ref } from 'vue'

import {
  inspectAudioFile,
  getFileIdentity,
  readableInspectionError,
} from './audio-metadata-reader'
import { buildExportPlan, exportPlanFingerprint } from './export-planner'
import {
  findRawTagConflicts,
  resolveRawTagConflict,
  type ConflictResolution,
  type RawTagConflict,
} from './metadata-diff'
import { validateDraft, type FieldValidation } from '@/domain/metadata-validation'
import { getExtension } from '@/domain/format'
import { duplicateLyricsLanguages, normalizeLyricsSlots } from '@/domain/lyrics'
import { emptyDraft } from '@/domain/model'
import type {
  CoverArtwork,
  ExportPlan,
  ExportRequest,
  MetadataDraft,
  QueueItem,
  RuntimeStatus,
  TechnicalInfo,
} from '@/domain/model'
import {
  BrowserMediaEngine,
  type MediaExportProgress,
} from '@/infrastructure/browser-media-engine'

export interface WorkspaceNotice {
  readonly kind: 'info' | 'success' | 'error'
  readonly message: string
  /** Omit to keep the notice visible until it is replaced or manually closed. */
  readonly dismissAfterMs?: number
}

export interface Workspace {
  readonly items: Ref<QueueItem[]>
  readonly selectedId: Ref<string | null>
  readonly selected: ComputedRef<QueueItem | null>
  readonly runtime: Ref<RuntimeStatus>
  readonly notice: Ref<WorkspaceNotice | null>
  readonly exportProgress: Ref<MediaExportProgress | null>
  dismissNotice(): void
  start(): void
  retryRuntime(): Promise<void>
  recheckProbe(id: string): Promise<void>
  addFiles(files: Iterable<File>): void
  select(id: string): void
  remove(id: string): void
  updateDraft(id: string, patch: Partial<MetadataDraft>): void
  restoreDraftField<K extends keyof MetadataDraft>(id: string, field: K): void
  addCover(id: string, cover: CoverArtwork): void
  replaceCover(id: string, coverId: string, cover: CoverArtwork): void
  updateCover(id: string, coverId: string, patch: Partial<CoverArtwork>): void
  removeCover(id: string, coverId: string): void
  moveCover(id: string, coverId: string, direction: -1 | 1): void
  getPlan(id: string, request: ExportRequest): ExportPlan | null
  getValidation(id: string): readonly FieldValidation[]
  getConflicts(id: string): readonly RawTagConflict[]
  resolveConflict(id: string, conflict: RawTagConflict, resolution: ConflictResolution): void
  export(id: string, plan: ExportPlan): Promise<void>
  cancelCurrent(): void
  dispose(): void
}

const likelyAudioExtensions = new Set([
  'mp3',
  'm4a',
  'aac',
  'flac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'wma',
  'ape',
  'amr',
  'mid',
  'midi',
  'alac',
])

const isLikelyAudio = (file: File): boolean =>
  file.type.startsWith('audio/') || likelyAudioExtensions.has(getExtension(file.name))

const randomId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `item-${Date.now()}-${Math.random().toString(36).slice(2)}`

const initialRuntime: RuntimeStatus = {
  state: 'preparing',
  version: 'loading',
  message: '正在后台准备媒体运行时。',
}

/** Brief confirmation notices should not keep obscuring the workspace. */
export const transientNoticeDismissAfterMs = 5_000

const fallbackTechnicalInfo = (file: File, duration?: number): TechnicalInfo => ({
  extension: getExtension(file.name) || 'unknown',
  mime: file.type || '未提供',
  container: '等待完整媒体解析',
  codec: '等待完整媒体解析',
  ...(duration === undefined ? {} : { duration }),
  tagTypes: [],
})

const nativeDuration = async (file: File): Promise<number | undefined> => {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<number | undefined>((resolve) => {
      const audio = document.createElement('audio')
      const timer = window.setTimeout(() => resolve(undefined), 4_000)
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => {
        window.clearTimeout(timer)
        resolve(Number.isFinite(audio.duration) ? audio.duration : undefined)
      }
      audio.onerror = () => {
        window.clearTimeout(timer)
        resolve(undefined)
      }
      audio.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

const revokeCover = (cover: CoverArtwork): void => {
  if (cover.previewUrl) URL.revokeObjectURL(cover.previewUrl)
}

const revokeItemCoverUrls = (item: QueueItem): void => {
  const revoked = new Set<string>()
  for (const cover of [...item.draft.covers, ...item.originalDraft.covers]) {
    if (!cover.previewUrl || revoked.has(cover.previewUrl)) continue
    revoked.add(cover.previewUrl)
    URL.revokeObjectURL(cover.previewUrl)
  }
}

const download = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

const sameIdentity = (left: QueueItem['identity'], right: QueueItem['identity']): boolean =>
  left.name === right.name &&
  left.size === right.size &&
  left.lastModified === right.lastModified

export const createWorkspace = (): Workspace => {
  const items = ref<QueueItem[]>([])
  const selectedId = ref<string | null>(null)
  const runtime = ref<RuntimeStatus>(initialRuntime)
  const notice = ref<WorkspaceNotice | null>(null)
  const exportProgress = ref<MediaExportProgress | null>(null)
  const engine = new BrowserMediaEngine()
  let inspecting = false
  let activeJobId: string | null = null
  let noticeDismissTimer: ReturnType<typeof window.setTimeout> | undefined
  let noticeVersion = 0
  const cancelledJobs = new Set<string>()

  const selected = computed<QueueItem | null>(
    () => items.value.find((item) => item.id === selectedId.value) ?? null,
  )

  const clearNoticeDismissTimer = (): void => {
    if (noticeDismissTimer === undefined) return
    window.clearTimeout(noticeDismissTimer)
    noticeDismissTimer = undefined
  }

  const dismissNotice = (): void => {
    noticeVersion += 1
    clearNoticeDismissTimer()
    notice.value = null
  }

  const publishNotice = (nextNotice: WorkspaceNotice): void => {
    clearNoticeDismissTimer()
    notice.value = nextNotice
    const version = ++noticeVersion
    if (!nextNotice.dismissAfterMs || nextNotice.dismissAfterMs <= 0) return
    noticeDismissTimer = window.setTimeout(() => {
      if (noticeVersion !== version) return
      noticeDismissTimer = undefined
      notice.value = null
    }, nextNotice.dismissAfterMs)
  }

  const setItem = (id: string, update: (item: QueueItem) => QueueItem): void => {
    items.value = items.value.map((item) => (item.id === id ? update(item) : item))
  }

  const withBrowserExportWarning = (item: QueueItem, reason?: string): QueueItem => {
    const withoutWarning = { ...item }
    delete withoutWarning.browserExportWarning
    return reason ? { ...withoutWarning, browserExportWarning: reason } : withoutWarning
  }

  const applyProbe = async (id: string, file: File): Promise<void> => {
    const probe = await engine.probe(file)
    const streamIndices = probe.attachedPictureStreamIndices

    setItem(id, (item) => {
      const technical = item.technical
        ? {
            ...item.technical,
            ...(probe.container ? { container: probe.container } : {}),
            ...(probe.audioCodec ? { codec: probe.audioCodec } : {}),
          }
        : item.technical
      const retainedWarnings = item.warnings.filter(
        (warning) =>
          !warning.startsWith('FFprobe ') &&
          warning !== '媒体运行时尚未就绪，未执行 FFprobe 交叉检查。',
      )
      const warnings = probe.warning ? [...retainedWarnings, probe.warning] : retainedWarnings
      const withTechnical = technical ? { ...item, technical, warnings } : { ...item, warnings }
      const withProbeState = { ...withTechnical }
      if (probe.diagnostic) withProbeState.probeDiagnostic = probe.diagnostic
      else delete withProbeState.probeDiagnostic
      if (!streamIndices) {
        return withBrowserExportWarning(
          withProbeState,
          probe.warning ??
            'FFprobe 未能完整交叉检查输入文件；导出副本的保留结果无法预先完全验证。',
        )
      }
      const embedded = item.originalDraft.covers.filter((cover) => cover.source === 'embedded')
      if (embedded.length === 0) {
        if (streamIndices.length === 0) return withBrowserExportWarning(withProbeState)
        const warning =
          'FFprobe 检测到内嵌封面流，但标签解析器未能读取对应图片；该封面不会写入浏览器导出的新副本。'
        return withBrowserExportWarning(
          withProbeState.warnings.includes(warning)
            ? withProbeState
            : { ...withProbeState, warnings: [...withProbeState.warnings, warning] },
          warning,
        )
      }
      if (embedded.length !== 1 || streamIndices.length !== 1) {
        const warning =
          '无法证明多个原始封面与容器流的一一对应关系；无法安全映射的封面不会写入浏览器导出的新副本。'
        return withBrowserExportWarning(
          withProbeState.warnings.includes(warning)
            ? withProbeState
            : { ...withProbeState, warnings: [...withProbeState.warnings, warning] },
          warning,
        )
      }

      const [cover] = embedded
      const [sourceIndex] = streamIndices
      if (!cover || sourceIndex === undefined) return withProbeState
      const mapCover = (candidate: CoverArtwork): CoverArtwork =>
        candidate.source === 'embedded' && candidate.id === cover.id
          ? { ...candidate, sourceIndex }
          : candidate
      return withBrowserExportWarning({
        ...withProbeState,
        draft: { ...withProbeState.draft, covers: withProbeState.draft.covers.map(mapCover) },
        originalDraft: {
          ...withProbeState.originalDraft,
          covers: withProbeState.originalDraft.covers.map(mapCover),
        },
      })
    })
  }

  const probeReadyItems = async (): Promise<void> => {
    for (const item of items.value) {
      if (item.status !== 'ready') continue
      await applyProbe(item.id, item.file)
    }
  }

  const runInspectionQueue = async (): Promise<void> => {
    if (inspecting) return
    inspecting = true
    try {
      while (true) {
        const next = items.value.find((item) => item.status === 'queued')
        if (!next) break
        setItem(next.id, (item) => ({ ...item, status: 'inspecting' }))
        try {
          const result = await inspectAudioFile(next.file)
          setItem(next.id, (item) => ({
            ...item,
            status: 'ready',
            draft: result.draft,
            originalDraft: result.draft,
            technical: result.technical,
            nativeTags: result.nativeTags,
            warnings: result.warnings,
            readNotices: result.readNotices,
          }))
          if (runtime.value.state === 'ready') await applyProbe(next.id, next.file)
        } catch (error) {
          const duration = await nativeDuration(next.file)
          setItem(next.id, (item) => ({
            ...item,
            status: 'needs-action',
            technical: fallbackTechnicalInfo(next.file, duration),
            warnings: ['完整嵌入元信息未能读取。仍可手动编辑草稿或复制本机 FFmpeg 命令。'],
            readNotices: [],
            error: readableInspectionError(error),
          }))
        }
      }
    } finally {
      inspecting = false
    }
  }

  const addFiles = (files: Iterable<File>): void => {
    const accepted: QueueItem[] = []
    let rejected = 0
    for (const file of files) {
      if (!isLikelyAudio(file)) {
        rejected += 1
        continue
      }
      accepted.push({
        id: randomId(),
        file,
        identity: getFileIdentity(file),
        status: 'queued',
        draft: emptyDraft(),
        originalDraft: emptyDraft(),
        nativeTags: [],
        warnings: [],
        readNotices: [],
        draftRevision: 0,
        createdAt: Date.now(),
      })
    }
    if (accepted.length > 0) {
      items.value = [...items.value, ...accepted]
      selectedId.value ??= accepted[0]?.id ?? null
      publishNotice({
        kind: 'info',
        message: `已加入 ${accepted.length} 个音频文件，正按顺序读取。`,
        dismissAfterMs: transientNoticeDismissAfterMs,
      })
      void runInspectionQueue()
    }
    if (rejected > 0) {
      publishNotice({
        kind: 'error',
        message: `${rejected} 个文件不是可识别的音频文件，未加入队列。`,
      })
    }
  }

  const updateDraft = (id: string, patch: Partial<MetadataDraft>): void => {
    setItem(id, (item) => {
      const normalizedPatch =
        patch.lyricsSlots === undefined
          ? patch
          : { ...patch, lyricsSlots: normalizeLyricsSlots(patch.lyricsSlots) }
      const duplicates =
        normalizedPatch.lyricsSlots === undefined
          ? []
          : duplicateLyricsLanguages(normalizedPatch.lyricsSlots)
      if (duplicates.length > 0) {
        publishNotice({
          kind: 'error',
          message: `每种歌词语言只能有一个槽位：${duplicates.join('、')} 已重复。`,
        })
        return item
      }
      const draft = { ...item.draft, ...normalizedPatch }
      if (JSON.stringify(draft) === JSON.stringify(item.draft)) return item
      return { ...item, draft, draftRevision: item.draftRevision + 1 }
    })
  }

  const restoreDraftField = <K extends keyof MetadataDraft>(id: string, field: K): void => {
    const item = items.value.find((candidate) => candidate.id === id)
    if (!item) return
    updateDraft(id, { [field]: item.originalDraft[field] } as Partial<MetadataDraft>)
  }

  const addCover = (id: string, cover: CoverArtwork): void => {
    const item = items.value.find((candidate) => candidate.id === id)
    if (!item) return
    updateDraft(id, { covers: [...item.draft.covers, cover] })
  }

  const replaceCover = (id: string, coverId: string, cover: CoverArtwork): void => {
    const item = items.value.find((candidate) => candidate.id === id)
    if (!item) return
    const old = item.draft.covers.find((candidate) => candidate.id === coverId)
    if (old) revokeCover(old)
    updateDraft(id, {
      covers: item.draft.covers.map((candidate) =>
        candidate.id === coverId
          ? {
              ...cover,
              ...(candidate.source === 'embedded' ? { replacesId: candidate.id } : {}),
            }
          : candidate,
      ),
    })
  }

  const updateCover = (id: string, coverId: string, patch: Partial<CoverArtwork>): void => {
    const item = items.value.find((candidate) => candidate.id === id)
    if (!item) return
    updateDraft(id, {
      covers: item.draft.covers.map((cover) =>
        cover.id === coverId ? { ...cover, ...patch } : cover,
      ),
    })
  }

  const removeCover = (id: string, coverId: string): void => {
    const item = items.value.find((candidate) => candidate.id === id)
    if (!item) return
    const cover = item.draft.covers.find((candidate) => candidate.id === coverId)
    if (cover) revokeCover(cover)
    updateDraft(id, { covers: item.draft.covers.filter((cover) => cover.id !== coverId) })
  }

  const moveCover = (id: string, coverId: string, direction: -1 | 1): void => {
    const item = items.value.find((candidate) => candidate.id === id)
    if (!item) return
    const index = item.draft.covers.findIndex((cover) => cover.id === coverId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= item.draft.covers.length) return
    const covers = [...item.draft.covers]
    const current = covers[index]
    const replacement = covers[target]
    if (!current || !replacement) return
    covers[index] = replacement
    covers[target] = current
    updateDraft(id, { covers })
  }

  const getPlan = (id: string, request: ExportRequest): ExportPlan | null => {
    const item = items.value.find((candidate) => candidate.id === id)
    return item ? buildExportPlan(item, request, runtime.value) : null
  }

  const getValidation = (id: string): readonly FieldValidation[] => {
    const item = items.value.find((candidate) => candidate.id === id)
    return item ? validateDraft(item.draft) : []
  }

  const getConflicts = (id: string): readonly RawTagConflict[] => {
    const item = items.value.find((candidate) => candidate.id === id)
    return item ? findRawTagConflicts(item.draft, item.originalDraft) : []
  }

  const resolveConflict = (
    id: string,
    conflict: RawTagConflict,
    resolution: ConflictResolution,
  ): void => {
    const item = items.value.find((candidate) => candidate.id === id)
    if (!item) return
    updateDraft(id, resolveRawTagConflict(item.draft, conflict, resolution))
  }

  const exportFile = async (id: string, plan: ExportPlan): Promise<void> => {
    if (activeJobId) {
      throw new Error('已有浏览器媒体任务正在执行；一次只能处理一个文件。')
    }
    const item = items.value.find((candidate) => candidate.id === id)
    if (!item) throw new Error('该队列项已不存在。')
    if (item.status === 'queued' || item.status === 'inspecting') {
      throw new Error('文件元信息仍在读取中，请等待读取完成后再导出。')
    }
    const errors = validateDraft(item.draft)
    if (errors.length > 0) throw new Error(errors[0]?.message ?? '请修正表单错误。')
    const currentPlan = buildExportPlan(
      item,
      {
        format: plan.format,
        quality: plan.quality,
        outputBaseName: plan.outputFileName.slice(
          0,
          -(plan.requestedExtension?.length ?? 0) - 1,
        ),
        allowOverwrite: false,
      },
      runtime.value,
    )
    if (
      plan.draftRevision !== item.draftRevision ||
      !sameIdentity(plan.sourceIdentity, item.identity) ||
      plan.runtimeVersion !== runtime.value.version ||
      !plan.runnable ||
      !currentPlan.runnable ||
      exportPlanFingerprint(plan) !== exportPlanFingerprint(currentPlan)
    ) {
      throw new Error('导出计划已过期，请检查预检并再次确认。')
    }

    const jobId = `${id}:${item.draftRevision}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    activeJobId = jobId
    setItem(id, (candidate) => {
      const next = { ...candidate, status: 'processing' as const }
      delete next.error
      return next
    })
    exportProgress.value = { ratio: 0, stage: 'preparing' }
    publishNotice({ kind: 'info', message: '正在生成新文件，源文件不会被修改。' })
    try {
      const result = await engine.export({
        source: item.file,
        plan,
        draft: item.draft,
        originalDraft: item.originalDraft,
        nativeTags: item.nativeTags,
        onProgress: (progress) => {
          if (activeJobId === jobId) exportProgress.value = progress
        },
      })
      if (cancelledJobs.has(jobId)) return
      download(result.blob, result.fileName)
      setItem(id, (candidate) => {
        const next = { ...candidate, status: 'succeeded' as const }
        delete next.error
        return next
      })
      publishNotice({
        kind: 'success',
        message: `已开始下载 ${result.fileName}。`,
        dismissAfterMs: transientNoticeDismissAfterMs,
      })
    } catch (error) {
      if (cancelledJobs.has(jobId)) return
      setItem(id, (candidate) => ({
        ...candidate,
        status: 'failed',
        error: error instanceof Error ? error.message : '浏览器导出失败。',
      }))
      publishNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : '浏览器导出失败。',
      })
      throw error
    } finally {
      if (activeJobId === jobId) {
        activeJobId = null
        exportProgress.value = null
      }
      cancelledJobs.delete(jobId)
    }
  }

  const cancelCurrent = (): void => {
    const jobId = activeJobId
    const current = items.value.find((item) => item.status === 'processing')
    if (!jobId && !current) return
    if (jobId) cancelledJobs.add(jobId)
    engine.terminate()
    runtime.value = {
      state: 'unavailable',
      version: 'restarting',
      message: '当前媒体任务已取消。可重新准备运行时后继续。',
    }
    if (current) {
      setItem(current.id, (item) => ({ ...item, status: 'cancelled' }))
    }
    exportProgress.value = null
    publishNotice({
      kind: 'info',
      message: '当前任务已取消，草稿已保留。',
      dismissAfterMs: transientNoticeDismissAfterMs,
    })
  }

  const retryRuntime = async (): Promise<void> => {
    await engine.prepare((status) => {
      runtime.value = status
    })
    if (runtime.value.state === 'ready') await probeReadyItems()
  }

  const recheckProbe = async (id: string): Promise<void> => {
    const item = items.value.find((candidate) => candidate.id === id)
    if (
      !item ||
      item.status === 'queued' ||
      item.status === 'inspecting' ||
      item.status === 'processing'
    ) {
      return
    }

    if (runtime.value.state !== 'ready') {
      await engine.prepare((status) => {
        runtime.value = status
      })
    }

    const current = items.value.find((candidate) => candidate.id === id)
    if (current) await applyProbe(current.id, current.file)
  }

  const remove = (id: string): void => {
    const item = items.value.find((candidate) => candidate.id === id)
    if (!item) return
    if (item.status === 'processing') cancelCurrent()
    revokeItemCoverUrls(item)
    items.value = items.value.filter((candidate) => candidate.id !== id)
    if (selectedId.value === id) selectedId.value = items.value[0]?.id ?? null
  }

  const start = (): void => {
    void retryRuntime()
  }

  const dispose = (): void => {
    dismissNotice()
    items.value.forEach(revokeItemCoverUrls)
    engine.terminate()
  }

  return {
    items,
    selectedId,
    selected,
    runtime,
    notice,
    exportProgress,
    dismissNotice,
    start,
    retryRuntime,
    recheckProbe,
    addFiles,
    select: (id) => {
      selectedId.value = id
    },
    remove,
    updateDraft,
    restoreDraftField,
    addCover,
    replaceCover,
    updateCover,
    removeCover,
    moveCover,
    getPlan,
    getValidation,
    getConflicts,
    resolveConflict,
    export: exportFile,
    cancelCurrent,
    dispose,
  }
}
