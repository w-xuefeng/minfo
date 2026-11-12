import { browserOutputFormatIds } from './audio-formats'
import type { BrowserOutputFormat } from './audio-formats'

/** @deprecated Prefer `browserOutputFormatIds` from `audio-formats`. */
export const stableOutputFormats = browserOutputFormatIds
/** @deprecated Prefer `BrowserOutputFormat` from `audio-formats`. */
export type StableOutputFormat = BrowserOutputFormat
export const exportFormatOptions = ['original', ...browserOutputFormatIds] as const

export type ExportFormat = (typeof exportFormatOptions)[number]
export type AudioQualityPreset = 'high' | 'balanced' | 'compact'
export type QueueItemStatus =
  | 'queued'
  | 'inspecting'
  | 'ready'
  | 'needs-action'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type CoverKind = 'front' | 'back' | 'disc' | 'artist' | 'other'

export interface FileIdentity {
  readonly name: string
  readonly size: number
  readonly lastModified: number
}

export interface CoverArtwork {
  readonly id: string
  readonly replacesId?: string
  readonly kind: CoverKind
  readonly mime: string
  readonly size: number
  readonly width?: number
  readonly height?: number
  readonly source: 'embedded' | 'replacement'
  readonly sourceIndex?: number
  readonly previewUrl?: string
  readonly file?: File
}

export interface EditableTag {
  readonly id: string
  readonly key: string
  readonly value: string
}

/** A single editable ordinary-lyrics slot, identified by its language code. */
export interface LyricsSlot {
  readonly id: string
  readonly language: string
  readonly descriptor: string
  readonly representation: 'plain' | 'synchronised'
  readonly text: string
  /** Number of imported source slots merged into this editable language slot. */
  readonly sourceCount?: number
}

/** @deprecated Use `LyricsSlot`; source identity is represented by `sourceCount`. */
export type LyricsSource = LyricsSlot

export interface MetadataDraft {
  readonly title: string
  readonly artists: readonly string[]
  readonly album: string
  readonly albumArtists: readonly string[]
  readonly genres: readonly string[]
  readonly releaseDate: string
  readonly comment: string
  readonly trackNo: string
  readonly trackTotal: string
  readonly discNo: string
  readonly discTotal: string
  readonly composers: readonly string[]
  readonly lyricsSlots: readonly LyricsSlot[]
  readonly covers: readonly CoverArtwork[]
  readonly rawTags: readonly EditableTag[]
}

export interface TechnicalInfo {
  readonly extension: string
  readonly mime: string
  readonly container: string
  readonly codec: string
  readonly duration?: number
  readonly sampleRate?: number
  readonly channels?: number
  readonly bitrate?: number
  readonly lossless?: boolean
  readonly tagTypes: readonly string[]
}

export interface NativeTag {
  readonly type: string
  readonly id: string
  readonly value: string
  /** A recognized private payload MINFO deliberately does not edit or verify. */
  readonly handling?: 'opaque-private'
}

export interface InspectionResult {
  readonly draft: MetadataDraft
  readonly technical: TechnicalInfo
  readonly nativeTags: readonly NativeTag[]
  readonly warnings: readonly string[]
  /** Non-blocking facts discovered while reading the source file. */
  readonly readNotices: readonly string[]
}

export interface ExportRequest {
  readonly format: ExportFormat
  readonly quality: AudioQualityPreset
  readonly outputBaseName: string
  readonly allowOverwrite: boolean
}

export type ExportRiskKind =
  | 'runtime-unavailable'
  | 'transcode'
  | 'container-change'
  | 'multi-value-flattening'
  | 'cover-type'
  | 'cover-capacity'
  | 'lyrics-structure'
  | 'metadata-write'

export interface ExportRisk {
  readonly id: string
  readonly kind: ExportRiskKind
  readonly title: string
  readonly description: string
  readonly requiresConfirmation: boolean
}

export interface ExportPlan {
  readonly sourceIdentity: FileIdentity
  readonly draftRevision: number
  readonly format: ExportFormat
  /** The actual filename extension determined by the selected browser output target. */
  readonly requestedExtension: string | null
  readonly resolvedFormat: StableOutputFormat | null
  readonly outputFileName: string
  readonly quality: AudioQualityPreset
  readonly requiresTranscode: boolean
  readonly engine: 'browser-runtime' | 'local-ffmpeg'
  readonly runnable: boolean
  readonly summary: string
  readonly risks: readonly ExportRisk[]
  readonly runtimeVersion: string
}

export type MediaProbeDiagnosticStage = 'runtime' | 'input' | 'ffprobe' | 'output'

/** A bounded, user-visible explanation for a failed browser media probe. */
export interface MediaProbeDiagnostic {
  readonly stage: MediaProbeDiagnosticStage
  readonly summary: string
  readonly exitCode?: number
  readonly logLines: readonly string[]
}

export interface QueueItem {
  readonly id: string
  readonly file: File
  readonly identity: FileIdentity
  readonly status: QueueItemStatus
  readonly draft: MetadataDraft
  readonly originalDraft: MetadataDraft
  readonly technical?: TechnicalInfo
  readonly nativeTags: readonly NativeTag[]
  readonly warnings: readonly string[]
  readonly readNotices: readonly string[]
  /** A probe condition that may reduce what a browser-exported copy can retain or verify. */
  readonly browserExportWarning?: string
  /** Present only while the latest FFprobe check could not be verified. */
  readonly probeDiagnostic?: MediaProbeDiagnostic
  readonly error?: string
  readonly draftRevision: number
  readonly createdAt: number
}

export interface RuntimeStatus {
  readonly state: 'preparing' | 'ready' | 'unavailable'
  readonly version: string
  readonly message: string
}

export const emptyDraft = (): MetadataDraft => ({
  title: '',
  artists: [],
  album: '',
  albumArtists: [],
  genres: [],
  releaseDate: '',
  comment: '',
  trackNo: '',
  trackTotal: '',
  discNo: '',
  discTotal: '',
  composers: [],
  lyricsSlots: [],
  covers: [],
  rawTags: [],
})
