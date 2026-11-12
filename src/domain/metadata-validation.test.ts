import { describe, expect, it } from 'vitest'

import { emptyDraft } from './model'
import { validateDraft, validateReleaseDate } from './metadata-validation'

describe('metadata validation', () => {
  it.each([
    ['2026', null],
    ['2026-02', null],
    ['2024-02-29', null],
    ['2025-02-29', '发行日期不是有效的日历日期。'],
    ['2026-13', '发行月份必须在 01 到 12 之间。'],
    ['2026/01/01', '发行日期请使用 YYYY、YYYY-MM 或 YYYY-MM-DD。'],
  ])('validates %s', (value, result) => {
    expect(validateReleaseDate(value)).toBe(result)
  })

  it('validates number pairs, lyric language, and duplicate lyric slots', () => {
    const errors = validateDraft({
      ...emptyDraft(),
      trackNo: '3',
      trackTotal: '2',
      lyricsSlots: [
        {
          id: 'invalid',
          language: 'z',
          descriptor: '',
          representation: 'plain',
          text: 'one',
        },
        {
          id: 'duplicate',
          language: 'z',
          descriptor: '',
          representation: 'plain',
          text: 'two',
        },
      ],
    })

    expect(errors.map((error) => error.message)).toEqual([
      '曲目编号不能大于总数。',
      '歌词语言请使用 2-8 个小写字母的语言码，可附带以连字符分隔的子标签，例如 und、zho、eng 或 jpn。',
      '每种歌词语言只能有一个槽位：z 已重复。',
    ])
  })

  it('rejects metadata syntax that cannot be passed as a safe FFmpeg key/value pair', () => {
    const errors = validateDraft({
      ...emptyDraft(),
      rawTags: [
        { id: 'bad-key', key: 'TXXX=unsafe', value: 'value' },
        { id: 'bad-value', key: 'TIT2', value: 'unsafe\u0000value' },
      ],
    })

    expect(errors[0]?.message).toContain('等号或 NUL')
  })
})
