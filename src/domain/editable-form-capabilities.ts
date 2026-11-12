import type { BrowserOutputFormat } from './audio-formats'

/** Existing metadata controls whose editability can vary by export target. */
export const editableMetadataFormFields = [
  'title',
  'artists',
  'album',
  'albumArtists',
  'genres',
  'releaseDate',
  'comment',
  'track',
  'disc',
  'composers',
  'lyrics',
  'covers',
  'rawTags',
] as const

export type EditableMetadataFormField = (typeof editableMetadataFormFields)[number]

export interface EditableFormFieldCapability {
  readonly editable: boolean
  readonly disabledReason?: string
}

export type EditableFormCapabilities = Readonly<
  Record<EditableMetadataFormField, EditableFormFieldCapability>
>

export const editableMetadataFormFieldLabels: Readonly<
  Record<EditableMetadataFormField, string>
> = {
  title: '标题',
  artists: '艺术家',
  album: '专辑',
  albumArtists: '专辑艺术家',
  genres: '流派',
  releaseDate: '发行日期',
  comment: '评论',
  track: '曲目',
  disc: '碟片',
  composers: '作曲者',
  lyrics: '歌词槽位',
  covers: '封面',
  rawTags: '原始文本标签',
}

const editable = (): EditableFormFieldCapability => ({ editable: true })

const allEditableFormCapabilities = (): EditableFormCapabilities => ({
  title: editable(),
  artists: editable(),
  album: editable(),
  albumArtists: editable(),
  genres: editable(),
  releaseDate: editable(),
  comment: editable(),
  track: editable(),
  disc: editable(),
  composers: editable(),
  lyrics: editable(),
  covers: editable(),
  rawTags: editable(),
})

/**
 * Per-target editability. Every browser output format must opt in with a
 * complete field map, so a new format cannot silently inherit unsupported
 * controls. Vue components consume this shape without format-name branches.
 */
export const editableFormCapabilitiesByFormat: Readonly<
  Record<BrowserOutputFormat, EditableFormCapabilities>
> = {
  mp3: allEditableFormCapabilities(),
  m4a: allEditableFormCapabilities(),
  aac: {
    ...allEditableFormCapabilities(),
    covers: {
      editable: false,
      disabledReason: 'ADTS AAC 不承载内嵌封面；请选择 MP3 或 M4A 以编辑封面。',
    },
  },
}

const unresolvedTargetCapabilities = allEditableFormCapabilities()

export const formCapabilitiesForOutput = (
  format: BrowserOutputFormat | null | undefined,
): EditableFormCapabilities =>
  format ? editableFormCapabilitiesByFormat[format] : unresolvedTargetCapabilities

export const disabledEditableMetadataFields = (
  capabilities: EditableFormCapabilities,
): readonly EditableMetadataFormField[] =>
  editableMetadataFormFields.filter((field) => !capabilities[field].editable)
