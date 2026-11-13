import { describe, expect, it } from 'vitest'
import type { IAudioMetadata, ILyricsTag } from 'music-metadata'

import {
  classifyMetadataQualityMessages,
  collectNativeTags,
  editableTextTags,
  isOpaquePrivateNativeTag,
  managedLyricsNativeTagKeys,
  parseLyricsSlots,
  isSynchronisedLyricsNativeTag,
  xmpPrivateMetadataReadNotice,
} from './audio-metadata-reader'

const lyrics = (value: unknown): readonly ILyricsTag[] => value as readonly ILyricsTag[]

const nativeTags = (
  tags: readonly { readonly type: string; readonly id: string; readonly value: unknown }[],
): IAudioMetadata['native'] => {
  const grouped: IAudioMetadata['native'] = {}
  for (const tag of tags) {
    const entries = grouped[tag.type] ?? []
    entries.push({ id: tag.id, value: tag.value })
    grouped[tag.type] = entries
  }
  return grouped
}

const mp3Source = {
  container: 'MPEG',
  codec: 'MPEG 1 Layer 3',
  tagTypes: ['ID3v2.4'],
  nativeTagTypes: ['ID3v2.4'],
} as const

const m4aSource = {
  container: 'MPEG-4',
  codec: 'AAC',
  tagTypes: ['iTunes'],
  nativeTagTypes: ['iTunes'],
} as const

const adtsAacSource = {
  container: 'ADTS/MPEG-4',
  codec: 'AAC',
  tagTypes: ['ID3v2.4'],
  nativeTagTypes: ['ID3v2.4'],
} as const

describe('metadata inspection messages', () => {
  it('turns a verified XMP PRIV diagnostic into one non-blocking read notice', () => {
    expect(
      classifyMetadataQualityMessages(
        ['Unknown PRIV owner-identifier: XMP', 'An unrelated parser warning'],
        true,
      ),
    ).toEqual({
      warnings: ['An unrelated parser warning'],
      readNotices: [xmpPrivateMetadataReadNotice],
    })
  })

  it('keeps an owner-only XMP diagnostic as a warning until its payload is verified', () => {
    expect(classifyMetadataQualityMessages(['Unknown PRIV owner-identifier: XMP'])).toEqual({
      warnings: ['Unknown PRIV owner-identifier: XMP'],
      readNotices: [],
    })
  })

  it('marks a structurally verified XMP PRIV as opaque and keeps it out of the text-tag editor', () => {
    const tags = collectNativeTags({
      native: nativeTags([
        {
          type: 'ID3v2.4',
          id: 'PRIV',
          value: {
            owner_identifier: 'XMP',
            data: new TextEncoder().encode(
              '<?xpacket begin="\uFEFF"?><x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>',
            ),
          },
        },
      ]),
    } as IAudioMetadata)

    expect(isOpaquePrivateNativeTag(tags[0]!)).toBe(true)
    expect(editableTextTags(tags)).toEqual([])
  })

  it('does not trust an owner or Adobe-branded tool string without XMP structure', () => {
    const tags = collectNativeTags({
      native: nativeTags([
        {
          type: 'ID3v2.4',
          id: 'PRIV',
          value: {
            owner_identifier: 'XMP',
            data: new TextEncoder().encode(
              '<payload xmlns:x="adobe:ns:meta/" xmlns:xmp="http://ns.adobe.com/xap/"><x:xmpmeta x:xmptk="Adobe XMP Core"><xmp:CreatorTool>Adobe Audition</xmp:CreatorTool></x:xmpmeta></payload>',
            ),
          },
        },
      ]),
    } as IAudioMetadata)

    expect(isOpaquePrivateNativeTag(tags[0]!)).toBe(false)
  })
})

describe('parseLyricsSlots', () => {
  it('merges repeated source languages into one independently editable language slot', () => {
    const result = parseLyricsSlots(
      lyrics([
        { language: 'ENG', descriptor: 'main', text: 'First source' },
        { language: 'eng', descriptor: 'translation', text: 'Second source' },
        {
          language: 'zho',
          descriptor: 'timed',
          syncText: [{ timestamp: 1_200, text: '字幕' }],
        },
      ]),
    )

    expect(result.slots).toEqual([
      {
        id: 'lyrics-0',
        language: 'eng',
        descriptor: 'main / translation',
        representation: 'plain',
        text: 'First source\n\nSecond source',
        sourceCount: 2,
      },
      {
        id: 'lyrics-2',
        language: 'zho',
        descriptor: 'timed',
        representation: 'synchronised',
        text: '[00:01.200]字幕',
        sourceCount: 1,
      },
    ])
    expect(result.warnings).toContain(
      '检测到多个 eng 歌词来源，已合并为一个可编辑语言槽位；导出副本只会尝试写回一个 eng 槽位。',
    )
  })

  it('moves an unusable source language into the explicit und slot with a warning', () => {
    const result = parseLyricsSlots(lyrics([{ language: '???', text: 'Unspecified lyrics' }]))

    expect(result.slots[0]?.language).toBe('und')
    expect(result.warnings[0]).toContain('已作为 und 导入')
  })

  it('imports FFmpeg generic ID3 user-text lyrics and their language-qualified slots', () => {
    const result = parseLyricsSlots(
      [],
      nativeTags([
        { type: 'ID3v2.4', id: 'TXXX:USLT', value: '[00:01.56] 那天的雨' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics-eng', value: 'The rain that day' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics_language', value: 'zho' },
      ]),
    )

    expect(result.slots).toEqual([
      {
        id: 'lyrics-native-0',
        language: 'zho',
        descriptor: '',
        representation: 'synchronised',
        text: '[00:01.56] 那天的雨',
        sourceCount: 1,
      },
      {
        id: 'lyrics-native-1',
        language: 'eng',
        descriptor: '',
        representation: 'plain',
        text: 'The rain that day',
        sourceCount: 1,
      },
    ])
  })

  it('uses the MP3 source capability for ID3 language helpers and qualified slots', () => {
    const result = parseLyricsSlots(
      [],
      nativeTags([
        { type: 'ID3v2.4', id: 'TXXX:lyrics', value: '中文歌词' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics_language', value: 'zho' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics-eng', value: 'English lyrics' },
        { type: 'MP4', id: '©lyr', value: 'Must not join an MP3 source' },
      ]),
      mp3Source,
    )

    expect(result.slots.map(({ language, text }) => ({ language, text }))).toEqual([
      { language: 'zho', text: '中文歌词' },
      { language: 'eng', text: 'English lyrics' },
    ])
  })

  it('uses the M4A source capability to map ©lyr to one unlabelled slot only', () => {
    const result = parseLyricsSlots(
      lyrics([{ language: 'eng', text: 'Primary M4A lyrics' }]),
      nativeTags([
        { type: 'iTunes', id: '©lyr', value: 'Primary M4A lyrics' },
        { type: 'iTunes', id: 'lyrics-eng', value: 'Not an M4A standard lyric field' },
        { type: 'iTunes', id: 'lyrics_language', value: 'eng' },
      ]),
      m4aSource,
    )

    expect(result.slots).toEqual([
      {
        id: 'lyrics-0',
        language: 'und',
        descriptor: '',
        representation: 'plain',
        text: 'Primary M4A lyrics',
        sourceCount: 1,
      },
    ])
    expect(result.warnings).toContain('M4A 的 ©lyr 不带标准歌词语言码，已作为 und 导入。')
  })

  it('warns and keeps the primary M4A lyric when source data exceeds its one-slot contract', () => {
    const result = parseLyricsSlots(
      [],
      nativeTags([
        { type: 'iTunes', id: '©lyr', value: 'Primary M4A lyrics' },
        { type: 'iTunes', id: '©lyr', value: 'Second M4A lyric' },
      ]),
      m4aSource,
    )

    expect(result.slots).toHaveLength(1)
    expect(result.slots[0]).toMatchObject({ language: 'und', text: 'Primary M4A lyrics' })
    expect(result.warnings).toContain(
      'M4A 的标准歌词字段只能读取一份普通歌词；额外不同歌词未进入编辑器。',
    )
  })

  it('uses the ADTS AAC source capability instead of accepting an MP4 lyric atom', () => {
    const result = parseLyricsSlots(
      [],
      nativeTags([
        { type: 'ID3v2.4', id: 'TXXX:lyrics-eng', value: 'AAC English lyrics' },
        { type: 'MP4', id: '©lyr', value: 'Must not join an ADTS source' },
      ]),
      adtsAacSource,
    )

    expect(result.slots.map(({ language, text }) => ({ language, text }))).toEqual([
      { language: 'eng', text: 'AAC English lyrics' },
    ])
  })

  it('keeps parsed standard lyrics as the canonical source while retaining distinct native slots', () => {
    const result = parseLyricsSlots(
      lyrics([
        {
          language: 'zho',
          descriptor: 'official',
          syncText: [{ timestamp: 1_560, text: '那天的雨' }],
        },
      ]),
      nativeTags([
        {
          type: 'ID3v2.4',
          id: 'USLT',
          value: { language: 'zho', text: '[00:01.56] 那天的雨' },
        },
        { type: 'ID3v2.4', id: 'TXXX:lyrics-eng', value: 'The rain that day' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics_language', value: 'zho' },
      ]),
    )

    expect(result.slots).toEqual([
      {
        id: 'lyrics-0',
        language: 'zho',
        descriptor: 'official',
        representation: 'synchronised',
        text: '[00:01.560]那天的雨',
        sourceCount: 1,
      },
      {
        id: 'lyrics-native-0',
        language: 'eng',
        descriptor: '',
        representation: 'plain',
        text: 'The rain that day',
        sourceCount: 1,
      },
    ])
  })

  it('retains a distinct timed source when the words match but its timestamps differ', () => {
    const result = parseLyricsSlots(
      lyrics([
        {
          language: 'zho',
          syncText: [{ timestamp: 1_000, text: '同一句' }],
        },
      ]),
      nativeTags([
        { type: 'ID3v2.4', id: 'TXXX:USLT', value: '[00:05.00] 同一句' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics_language', value: 'zho' },
      ]),
    )

    expect(result.slots).toEqual([
      {
        id: 'lyrics-0',
        language: 'zho',
        descriptor: '',
        representation: 'synchronised',
        text: '[00:01.000]同一句\n\n[00:05.00] 同一句',
        sourceCount: 2,
      },
    ])
  })

  it('uses the single native lyrics language declaration for an unlabelled common lyric', () => {
    const result = parseLyricsSlots(
      lyrics([{ text: 'Generic lyrics', syncText: [] }]),
      nativeTags([
        { type: 'ID3v2.4', id: 'TXXX:lyrics', value: 'Generic lyrics' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics_language', value: 'zho' },
      ]),
    )

    expect(result.slots).toEqual([
      {
        id: 'lyrics-0',
        language: 'zho',
        descriptor: '',
        representation: 'plain',
        text: 'Generic lyrics',
        sourceCount: 1,
      },
    ])
  })

  it('recognizes common native aliases and keeps language-qualified tags separate', () => {
    const result = parseLyricsSlots(
      [],
      nativeTags([
        { type: 'ASF', id: 'WM/Lyrics', value: 'Windows media lyrics' },
        { type: 'VORBIS', id: 'UNSYNCEDLYRICS-jpn', value: '日本語歌詞' },
        { type: 'MP4', id: '©lyr', value: 'iTunes lyrics' },
      ]),
    )

    expect(
      result.slots.map(({ language, text, sourceCount }) => ({ language, text, sourceCount })),
    ).toEqual([
      {
        language: 'und',
        text: 'Windows media lyrics\n\niTunes lyrics',
        sourceCount: 2,
      },
      { language: 'jpn', text: '日本語歌詞', sourceCount: 1 },
    ])
  })

  it('keeps lyric aliases out of the generic raw-tag editor once they are managed as slots', () => {
    expect(
      editableTextTags([
        { type: 'ID3v2.4', id: 'TXXX:USLT', value: '[00:01.56] 那天的雨' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics-eng', value: 'The rain that day' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics_language', value: 'zho' },
        { type: 'ID3v2.4', id: 'TIT2', value: '各自经过' },
      ]),
    ).toEqual([
      {
        id: 'ID3v2.4-TIT2-0',
        key: 'TIT2',
        value: '各自经过',
      },
    ])
  })

  it('keeps M4A custom lyric-looking fields in the raw-tag editor instead of treating them as ©lyr', () => {
    expect(
      editableTextTags(
        [
          { type: 'iTunes', id: '©lyr', value: 'M4A primary lyrics' },
          { type: 'iTunes', id: 'lyrics_language', value: 'eng' },
          { type: 'iTunes', id: 'lyrics-eng', value: 'Custom secondary lyrics' },
        ],
        m4aSource,
      ),
    ).toEqual([
      {
        id: 'iTunes-lyrics_language-0',
        key: 'lyrics_language',
        value: 'eng',
      },
      {
        id: 'iTunes-lyrics-eng-1',
        key: 'lyrics-eng',
        value: 'Custom secondary lyrics',
      },
    ])
  })

  it('only marks source-configured M4A lyrics for later export cleanup', () => {
    const tags = collectNativeTags(
      {
        native: nativeTags([
          { type: 'iTunes', id: '©lyr', value: 'M4A primary lyrics' },
          { type: 'iTunes', id: 'lyrics-eng', value: 'Custom secondary lyrics' },
          { type: 'iTunes', id: 'lyrics_language', value: 'eng' },
        ]),
      } as IAudioMetadata,
      m4aSource,
    )

    expect(tags.map(({ id, lyricsSlotManaged }) => ({ id, lyricsSlotManaged }))).toEqual([
      { id: '©lyr', lyricsSlotManaged: true },
      { id: 'lyrics-eng', lyricsSlotManaged: false },
      { id: 'lyrics_language', lyricsSlotManaged: false },
    ])
    expect(managedLyricsNativeTagKeys(tags)).toEqual(['©lyr'])
  })

  it('keeps the exact recognized native identifiers for later export cleanup', () => {
    expect(
      managedLyricsNativeTagKeys([
        { type: 'ID3v2.4', id: 'TXXX:lyrics-eng', value: 'English lyrics' },
        { type: 'ID3v2.4', id: 'SYLT:eng', value: 'synchronised lyrics' },
        { type: 'ID3v2.4', id: 'TXXX:lyrics_language', value: 'zho' },
        { type: 'ID3v2.4', id: 'TIT2', value: 'A title' },
      ]),
    ).toEqual(['TXXX:lyrics-eng', 'SYLT:eng', 'TXXX:lyrics_language'])
  })

  it('recognizes synchronised aliases even behind a user-text prefix', () => {
    expect(isSynchronisedLyricsNativeTag('SYLT:eng')).toBe(true)
    expect(isSynchronisedLyricsNativeTag('TXXX:SYLT')).toBe(true)
    expect(isSynchronisedLyricsNativeTag('TXXX:USLT')).toBe(false)
  })
})
