import { defaultLyricsLanguage } from '@/domain/lyrics'
import type { EditableTag, LyricsSlot, MetadataDraft } from '@/domain/model'

export type StandardMetadataField =
  | 'title'
  | 'artists'
  | 'album'
  | 'albumArtists'
  | 'genres'
  | 'releaseDate'
  | 'comment'
  | 'track'
  | 'disc'
  | 'composers'
  | 'lyrics'

export interface RawTagConflict {
  readonly tagId: string
  readonly tagKey: string
  readonly field: StandardMetadataField
  readonly fieldLabel: string
  readonly standardValue: string
  readonly rawValue: string
}

export type ConflictResolution = 'standard' | 'raw'

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export const changedStandardFields = (
  draft: MetadataDraft,
  original: MetadataDraft,
): ReadonlySet<StandardMetadataField> => {
  const fields = new Set<StandardMetadataField>()
  if (!same(draft.title, original.title)) fields.add('title')
  if (!same(draft.artists, original.artists)) fields.add('artists')
  if (!same(draft.album, original.album)) fields.add('album')
  if (!same(draft.albumArtists, original.albumArtists)) fields.add('albumArtists')
  if (!same(draft.genres, original.genres)) fields.add('genres')
  if (!same(draft.releaseDate, original.releaseDate)) fields.add('releaseDate')
  if (!same(draft.comment, original.comment)) fields.add('comment')
  if (!same(draft.trackNo, original.trackNo) || !same(draft.trackTotal, original.trackTotal)) {
    fields.add('track')
  }
  if (!same(draft.discNo, original.discNo) || !same(draft.discTotal, original.discTotal)) {
    fields.add('disc')
  }
  if (!same(draft.composers, original.composers)) fields.add('composers')
  if (!same(draft.lyricsSlots, original.lyricsSlots)) fields.add('lyrics')
  return fields
}

const indexedTags = (tags: readonly EditableTag[]): Map<string, EditableTag> =>
  new Map(tags.map((tag) => [tag.id, tag]))

const mappedRawTagFields: Readonly<Record<string, StandardMetadataField>> = {
  title: 'title',
  tit2: 'title',
  '©nam': 'title',
  artist: 'artists',
  tpe1: 'artists',
  '©art': 'artists',
  album: 'album',
  talb: 'album',
  '©alb': 'album',
  album_artist: 'albumArtists',
  albumartist: 'albumArtists',
  tpe2: 'albumArtists',
  aart: 'albumArtists',
  genre: 'genres',
  tcon: 'genres',
  '©gen': 'genres',
  date: 'releaseDate',
  year: 'releaseDate',
  tdrc: 'releaseDate',
  tyer: 'releaseDate',
  '©day': 'releaseDate',
  comment: 'comment',
  comm: 'comment',
  track: 'track',
  trck: 'track',
  trkn: 'track',
  disc: 'disc',
  tpos: 'disc',
  disk: 'disc',
  composer: 'composers',
  tcom: 'composers',
  '©wrt': 'composers',
  lyrics: 'lyrics',
  uslt: 'lyrics',
  '©lyr': 'lyrics',
  lyrics_language: 'lyrics',
}

const fieldLabels: Readonly<Record<StandardMetadataField, string>> = {
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
  lyrics: '歌词',
}

export const normalizedRawTagKey = (key: string): string => key.trim().toLowerCase()

export const rawTagField = (key: string): StandardMetadataField | null => {
  const normalized = normalizedRawTagKey(key)
  return mappedRawTagFields[normalized] ?? (normalized.startsWith('lyrics-') ? 'lyrics' : null)
}

const join = (values: readonly string[]): string => values.join(' / ')

export const standardValueForField = (
  draft: MetadataDraft,
  field: StandardMetadataField,
): string => {
  switch (field) {
    case 'title':
      return draft.title
    case 'artists':
      return join(draft.artists)
    case 'album':
      return draft.album
    case 'albumArtists':
      return join(draft.albumArtists)
    case 'genres':
      return join(draft.genres)
    case 'releaseDate':
      return draft.releaseDate
    case 'comment':
      return draft.comment
    case 'track':
      return draft.trackNo
        ? `${draft.trackNo}${draft.trackTotal ? `/${draft.trackTotal}` : ''}`
        : ''
    case 'disc':
      return draft.discNo
        ? `${draft.discNo}${draft.discTotal ? `/${draft.discTotal}` : ''}`
        : ''
    case 'composers':
      return join(draft.composers)
    case 'lyrics':
      return draft.lyricsSlots[0]?.text ?? ''
  }
}

const comparisonValue = (value: string): string => value.trim().replace(/\r\n?/g, '\n')

const standardValueForRawTag = (
  draft: MetadataDraft,
  key: string,
  field: StandardMetadataField,
): string => {
  if (field !== 'lyrics') return standardValueForField(draft, field)
  const normalized = normalizedRawTagKey(key)
  if (normalized === 'lyrics_language') return draft.lyricsSlots[0]?.language ?? ''
  if (normalized.startsWith('lyrics-')) {
    const language = normalized.slice('lyrics-'.length)
    return draft.lyricsSlots.find((slot) => slot.language === language)?.text ?? ''
  }
  return standardValueForField(draft, field)
}

export const findRawTagConflicts = (
  draft: MetadataDraft,
  original: MetadataDraft,
): readonly RawTagConflict[] => {
  const changedFields = changedStandardFields(draft, original)
  const originalTags = indexedTags(original.rawTags)
  const conflicts: RawTagConflict[] = []

  for (const tag of draft.rawTags) {
    const originalTag = originalTags.get(tag.id)
    const rawTagChanged =
      !originalTag || originalTag.key !== tag.key || originalTag.value !== tag.value
    const field = rawTagField(tag.key)
    if (!rawTagChanged || !field || !changedFields.has(field)) continue

    const standardValue = standardValueForRawTag(draft, tag.key, field)
    if (comparisonValue(tag.value) === comparisonValue(standardValue)) continue
    conflicts.push({
      tagId: tag.id,
      tagKey: tag.key,
      field,
      fieldLabel: fieldLabels[field],
      standardValue,
      rawValue: tag.value,
    })
  }

  return conflicts
}

const splitMultiValue = (value: string): string[] =>
  value
    .split(/[\n,;/]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const numberPair = (value: string): { readonly no: string; readonly total: string } => {
  const match = /^\s*(\d*)\s*(?:\/\s*(\d*)\s*)?$/.exec(value)
  return { no: match?.[1] ?? value.trim(), total: match?.[2] ?? '' }
}

export const resolveRawTagConflict = (
  draft: MetadataDraft,
  conflict: RawTagConflict,
  resolution: ConflictResolution,
): Partial<MetadataDraft> => {
  if (resolution === 'standard') {
    return {
      rawTags: draft.rawTags.map((tag) =>
        tag.id === conflict.tagId
          ? { ...tag, value: standardValueForField(draft, conflict.field) }
          : tag,
      ),
    }
  }

  const rawValue = conflict.rawValue
  switch (conflict.field) {
    case 'title':
      return { title: rawValue }
    case 'artists':
      return { artists: splitMultiValue(rawValue) }
    case 'album':
      return { album: rawValue }
    case 'albumArtists':
      return { albumArtists: splitMultiValue(rawValue) }
    case 'genres':
      return { genres: splitMultiValue(rawValue) }
    case 'releaseDate':
      return { releaseDate: rawValue }
    case 'comment':
      return { comment: rawValue }
    case 'track': {
      const pair = numberPair(rawValue)
      return { trackNo: pair.no, trackTotal: pair.total }
    }
    case 'disc': {
      const pair = numberPair(rawValue)
      return { discNo: pair.no, discTotal: pair.total }
    }
    case 'composers':
      return { composers: splitMultiValue(rawValue) }
    case 'lyrics': {
      const key = normalizedRawTagKey(conflict.tagKey)
      const requestedLanguage = key.startsWith('lyrics-')
        ? key.slice('lyrics-'.length)
        : undefined
      const index = requestedLanguage
        ? draft.lyricsSlots.findIndex((slot) => slot.language === requestedLanguage)
        : 0
      const current = index >= 0 ? draft.lyricsSlots[index] : undefined
      const slot: LyricsSlot = current
        ? key === 'lyrics_language'
          ? { ...current, language: rawValue.toLowerCase() }
          : { ...current, text: rawValue }
        : {
            id: `raw-lyrics-${requestedLanguage ?? defaultLyricsLanguage}`,
            language:
              key === 'lyrics_language'
                ? rawValue.toLowerCase()
                : (requestedLanguage ?? defaultLyricsLanguage),
            descriptor: '',
            representation: 'plain',
            text: key === 'lyrics_language' ? '' : rawValue,
          }
      if (current) {
        return {
          lyricsSlots: draft.lyricsSlots.map((candidate, candidateIndex) =>
            candidateIndex === index ? slot : candidate,
          ),
        }
      }
      return { lyricsSlots: [...draft.lyricsSlots, slot] }
    }
  }
}

export interface RawTagChange {
  readonly key: string
  readonly value: string
}

/**
 * Generic FFmpeg `-metadata key=value` cannot address one member of a
 * duplicate key set (for example multiple TXXX/COMM fields). Treat those rows
 * as an explicit new-copy downgrade until a container-specific adapter can
 * preserve them exactly.
 */
export const rawTagEditSafetyIssue = (
  draft: readonly EditableTag[],
  original: readonly EditableTag[],
): string | null => {
  const originalKeys = new Map<string, number>()
  const draftKeys = new Map<string, number>()
  for (const tag of original) {
    const key = normalizedRawTagKey(tag.key)
    originalKeys.set(key, (originalKeys.get(key) ?? 0) + 1)
  }
  for (const tag of draft) {
    const key = normalizedRawTagKey(tag.key)
    draftKeys.set(key, (draftKeys.get(key) ?? 0) + 1)
  }

  const originalById = indexedTags(original)
  for (const tag of draft) {
    const before = originalById.get(tag.id)
    const originalKey = before ? normalizedRawTagKey(before.key) : ''
    const draftKey = normalizedRawTagKey(tag.key)
    if ((before && (before.key !== tag.key || before.value !== tag.value)) || !before) {
      if ((originalKeys.get(originalKey) ?? 0) > 1 || (draftKeys.get(draftKey) ?? 0) > 1) {
        const key = before?.key ?? tag.key
        return `高级标签 ${key} 存在多个同名槽位，通用写入器无法精确修改其中一项；新副本中的同名槽位可能合并、重排或一起变化。`
      }
    }
  }
  for (const tag of original) {
    if (
      !draft.some((candidate) => candidate.id === tag.id) &&
      originalKeys.get(normalizedRawTagKey(tag.key))! > 1
    ) {
      return `高级标签 ${tag.key} 存在多个同名槽位，通用写入器无法精确删除其中一项；新副本中的同名槽位可能合并、重排或一起变化。`
    }
  }
  return null
}

/**
 * A standard FFmpeg metadata assignment can overwrite every native tag with
 * the same semantic key. Report it as a confirmation risk until a
 * container-specific adapter can preserve descriptor and ordering exactly.
 */
export const standardFieldRawTagSafetyIssue = (
  draft: MetadataDraft,
  original: MetadataDraft,
): string | null => {
  const issue = standardFieldRawTagSafetyIssues(draft, original)[0]
  return issue
    ? `标准字段 ${issue.fieldLabel} 对应的高级标签 ${issue.tagKey} 有多个同名槽位，通用写入器无法精确保留这些槽位的身份或顺序。`
    : null
}

export interface StandardFieldRawTagSafetyIssueDetail {
  readonly field: StandardMetadataField
  readonly fieldLabel: string
  readonly tagKey: string
}

/**
 * Reports standard-field writes whose matching raw tag has several slots.
 * The browser can still produce a new file after an explicit loss warning,
 * but these fields cannot receive an exact per-slot preservation promise.
 */
export const standardFieldRawTagSafetyIssues = (
  draft: MetadataDraft,
  original: MetadataDraft,
): readonly StandardFieldRawTagSafetyIssueDetail[] => {
  const changedFields = changedStandardFields(draft, original)
  const counts = new Map<string, number>()
  for (const tag of original.rawTags) {
    const key = normalizedRawTagKey(tag.key)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const issues: StandardFieldRawTagSafetyIssueDetail[] = []
  const seen = new Set<StandardMetadataField>()
  for (const tag of original.rawTags) {
    const field = rawTagField(tag.key)
    if (
      field &&
      changedFields.has(field) &&
      (counts.get(normalizedRawTagKey(tag.key)) ?? 0) > 1 &&
      !seen.has(field)
    ) {
      seen.add(field)
      issues.push({ field, fieldLabel: fieldLabels[field], tagKey: tag.key })
    }
  }
  return issues
}

export const standardFieldsWithDuplicateRawTagSlots = (
  draft: MetadataDraft,
  original: MetadataDraft,
): ReadonlySet<StandardMetadataField> =>
  new Set(standardFieldRawTagSafetyIssues(draft, original).map((issue) => issue.field))

/** Returns only intentional additions, changes, and deletions. */
export const changedRawTags = (
  draft: readonly EditableTag[],
  original: readonly EditableTag[],
): readonly RawTagChange[] => {
  const current = indexedTags(draft)
  const initial = indexedTags(original)
  const changes: RawTagChange[] = []

  for (const tag of draft) {
    const before = initial.get(tag.id)
    if (!before || before.key !== tag.key || before.value !== tag.value) {
      changes.push({ key: tag.key, value: tag.value })
    }
  }

  for (const tag of original) {
    if (!current.has(tag.id)) {
      changes.push({ key: tag.key, value: '' })
    }
  }

  return changes
}

export const draftHasChanges = (draft: MetadataDraft, original: MetadataDraft): boolean =>
  changedStandardFields(draft, original).size > 0 ||
  changedRawTags(draft.rawTags, original.rawTags).length > 0 ||
  !same(draft.covers, original.covers)
