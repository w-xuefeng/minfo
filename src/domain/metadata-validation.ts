import type { MetadataDraft } from './model'
import {
  duplicateLyricsLanguages,
  isLyricsLanguage,
  lyricsLanguageValidationMessage,
  normalizeLyricsLanguage,
} from './lyrics'

export interface FieldValidation {
  readonly field: keyof MetadataDraft
  readonly message: string
}

const datePattern = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/
const positiveWholeNumber = /^\d+$/

export const validateReleaseDate = (value: string): string | null => {
  if (!value) return null
  const match = datePattern.exec(value)
  if (!match) return '发行日期请使用 YYYY、YYYY-MM 或 YYYY-MM-DD。'

  const year = Number(match[1])
  const month = match[2] ? Number(match[2]) : undefined
  const day = match[3] ? Number(match[3]) : undefined
  if (year < 1 || year > 9999) return '发行年份必须在 0001 到 9999 之间。'
  if (month !== undefined && (month < 1 || month > 12)) return '发行月份必须在 01 到 12 之间。'
  if (day !== undefined && month !== undefined) {
    const maximum = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (day < 1 || day > maximum) return '发行日期不是有效的日历日期。'
  }

  return null
}

const validateNumberPair = (number: string, total: string, label: string): string | null => {
  if (number && !positiveWholeNumber.test(number)) return `${label}编号必须是正整数。`
  if (total && !positiveWholeNumber.test(total)) return `${label}总数必须是正整数。`
  if (number && total && Number(number) > Number(total)) {
    return `${label}编号不能大于总数。`
  }
  return null
}

export const validateDraft = (draft: MetadataDraft): FieldValidation[] => {
  const errors: FieldValidation[] = []
  const releaseDate = validateReleaseDate(draft.releaseDate)
  if (releaseDate) errors.push({ field: 'releaseDate', message: releaseDate })

  const track = validateNumberPair(draft.trackNo, draft.trackTotal, '曲目')
  if (track) errors.push({ field: 'trackNo', message: track })

  const disc = validateNumberPair(draft.discNo, draft.discTotal, '碟片')
  if (disc) errors.push({ field: 'discNo', message: disc })

  const invalidLyricsSlot = draft.lyricsSlots.find(
    (slot) =>
      !isLyricsLanguage(slot.language) ||
      slot.language !== normalizeLyricsLanguage(slot.language),
  )
  if (invalidLyricsSlot) {
    errors.push({ field: 'lyricsSlots', message: lyricsLanguageValidationMessage })
  }

  const duplicateLanguages = duplicateLyricsLanguages(draft.lyricsSlots)
  if (duplicateLanguages.length > 0) {
    errors.push({
      field: 'lyricsSlots',
      message: `每种歌词语言只能有一个槽位：${duplicateLanguages.join('、')} 已重复。`,
    })
  }

  if (draft.lyricsSlots.some((slot) => slot.text.includes('\u0000'))) {
    errors.push({ field: 'lyricsSlots', message: '歌词内容不能包含 NUL 字符。' })
  }

  for (const tag of draft.rawTags) {
    if (!tag.key.trim()) {
      errors.push({ field: 'rawTags', message: '高级标签的键不能为空。' })
      break
    }
    if (tag.key.includes('=') || tag.key.includes('\u0000')) {
      errors.push({
        field: 'rawTags',
        message: '高级标签的键不能包含等号或 NUL 字符。',
      })
      break
    }
    if (tag.value.includes('\u0000')) {
      errors.push({ field: 'rawTags', message: '高级标签的值不能包含 NUL 字符。' })
      break
    }
  }

  return errors
}

export const splitValues = (input: string): string[] =>
  input
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)

export const joinValues = (values: readonly string[]): string => values.join(', ')
