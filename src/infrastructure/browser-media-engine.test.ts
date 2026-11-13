import { describe, expect, it } from 'vitest'

import {
  assertCoverReadback,
  assertLyricsManifestReadback,
  assertOrdinaryLyricsReadback,
  assertOutputProbe,
  requiresFullMetadataReadback,
} from './browser-media-engine'
import { emptyDraft } from '@/domain/model'
import type { ExportPlan } from '@/domain/model'

const plan = (riskId?: string): ExportPlan => ({
  sourceIdentity: { name: 'source.mp3', size: 1, lastModified: 1 },
  draftRevision: 0,
  format: 'original',
  requestedExtension: 'mp3',
  resolvedFormat: 'mp3',
  outputFileName: 'output.mp3',
  quality: 'high',
  requiresTranscode: false,
  engine: 'browser-runtime',
  runnable: true,
  summary: 'test',
  risks: riskId
    ? [
        {
          id: riskId,
          kind: 'metadata-write',
          title: 'test risk',
          description: 'test',
          requiresConfirmation: true,
        },
      ]
    : [],
  runtimeVersion: 'test',
})

describe('assertOrdinaryLyricsReadback', () => {
  it('keeps output container/audio validation eligible while skipping metadata vetoes for confirmed unverified input', () => {
    expect(requiresFullMetadataReadback(plan())).toBe(true)
    expect(requiresFullMetadataReadback(plan('probe-incomplete'))).toBe(false)
    expect(requiresFullMetadataReadback(plan('unsupported-source'))).toBe(false)
  })

  it('rejects a retained source-specific lyric alias after the slot manifest replaces it', () => {
    const original = {
      ...emptyDraft(),
      lyricsSlots: [
        {
          id: 'lyrics-0',
          language: 'eng',
          descriptor: '',
          representation: 'plain' as const,
          text: 'old lyrics',
        },
      ],
    }
    const draft = {
      ...original,
      lyricsSlots: [
        {
          ...original.lyricsSlots[0]!,
          language: 'zho',
          text: '[00:01.00] new lyrics\n[00:02.50] second line',
        },
      ],
    }

    expect(() =>
      assertOrdinaryLyricsReadback(
        {
          format: {
            tags: {
              'TXXX:lyrics-eng': original.lyricsSlots[0]!.text,
              lyrics: draft.lyricsSlots[0]!.text.replace(/\n/g, '\r\n'),
              lyrics_language: draft.lyricsSlots[0]!.language,
            },
          },
        },
        'mp3',
        draft,
        original,
        ['TXXX:lyrics-eng', 'lyrics-eng'],
      ),
    ).toThrow('歌词标签 TXXX:lyrics-eng')
  })

  it('accepts the current slot tags once a managed source alias is absent', () => {
    const original = {
      ...emptyDraft(),
      lyricsSlots: [
        {
          id: 'lyrics-0',
          language: 'eng',
          descriptor: '',
          representation: 'plain' as const,
          text: 'old lyrics',
        },
      ],
    }
    const draft = {
      ...original,
      lyricsSlots: [
        {
          ...original.lyricsSlots[0]!,
          language: 'zho',
          text: '[00:01.00] new lyrics\n[00:02.50] second line',
        },
      ],
    }

    expect(() =>
      assertOrdinaryLyricsReadback(
        {
          format: {
            tags: {
              lyrics: draft.lyricsSlots[0]!.text.replace(/\n/g, '\r\n'),
              lyrics_language: draft.lyricsSlots[0]!.language,
            },
          },
        },
        'mp3',
        draft,
        original,
        ['TXXX:lyrics-eng', 'lyrics-eng'],
      ),
    ).not.toThrow()
  })

  it('rejects a missing requested generic lyrics tag', () => {
    const original = {
      ...emptyDraft(),
      lyricsSlots: [
        {
          id: 'lyrics-0',
          language: 'eng',
          descriptor: '',
          representation: 'plain' as const,
          text: 'old lyrics',
        },
      ],
    }
    const draft = {
      ...original,
      lyricsSlots: [{ ...original.lyricsSlots[0]!, text: 'new lyrics' }],
    }

    expect(() =>
      assertOrdinaryLyricsReadback({ format: { tags: {} } }, 'mp3', draft, original),
    ).toThrow('普通歌词')
  })

  it('rejects a parsed output manifest that retains a deleted language', () => {
    const draft = {
      ...emptyDraft(),
      lyricsSlots: [
        {
          id: 'zho',
          language: 'zho',
          descriptor: '',
          representation: 'plain' as const,
          text: '中文歌词',
        },
      ],
    }

    expect(() =>
      assertLyricsManifestReadback(
        [
          draft.lyricsSlots[0]!,
          {
            id: 'eng',
            language: 'eng',
            descriptor: '',
            representation: 'plain',
            text: 'English lyrics',
          },
        ],
        draft,
        'mp3',
      ),
    ).toThrow('当前表单之外的歌词语言（eng）')
  })

  it('does not veto an expected language when a parser normalizes its text representation', () => {
    const draft = {
      ...emptyDraft(),
      lyricsSlots: [
        {
          id: 'zho',
          language: 'zho',
          descriptor: '',
          representation: 'synchronised' as const,
          text: '[00:01.56] 中文歌词\n[00:02.5] 第二行',
        },
      ],
    }

    expect(() =>
      assertLyricsManifestReadback(
        [
          {
            ...draft.lyricsSlots[0]!,
            text: '[00:01.560] 中文歌词\n[00:02.500] 第二行\n',
          },
        ],
        draft,
        'mp3',
      ),
    ).not.toThrow()
  })

  it('uses the M4A capability to verify only the primary ©lyr-mapped text', () => {
    const draft = {
      ...emptyDraft(),
      lyricsSlots: [
        {
          id: 'zho',
          language: 'zho',
          descriptor: '',
          representation: 'plain' as const,
          text: '中文歌词',
        },
        {
          id: 'eng',
          language: 'eng',
          descriptor: '',
          representation: 'plain' as const,
          text: 'English lyrics',
        },
      ],
    }

    expect(() =>
      assertOrdinaryLyricsReadback(
        { format: { tags: { lyrics: '中文歌词' } } },
        'm4a',
        draft,
        draft,
        ['TXXX:lyrics-eng', 'TXXX:lyrics_language'],
      ),
    ).not.toThrow()
    expect(() =>
      assertLyricsManifestReadback(
        [
          {
            ...draft.lyricsSlots[0]!,
            language: 'und',
          },
        ],
        draft,
        'm4a',
      ),
    ).not.toThrow()
  })
})

describe('output verification capability integration', () => {
  const frontPng = {
    id: 'front',
    kind: 'front' as const,
    mime: 'image/png',
    size: 3,
    source: 'replacement' as const,
  }

  it('accepts an M4A covr image without a fabricated ID3 role and ignores its order', () => {
    expect(() =>
      assertCoverReadback(
        'm4a',
        [
          { format: 'image/jpeg', data: new Uint8Array(4) },
          { format: 'image/png', data: new Uint8Array(3) },
        ],
        [
          frontPng,
          {
            ...frontPng,
            id: 'back',
            kind: 'back',
            mime: 'image/jpeg',
            size: 4,
          },
        ],
      ),
    ).not.toThrow()
    expect(() =>
      assertCoverReadback(
        'm4a',
        [{ format: 'image/png', data: new Uint8Array(3) }],
        [frontPng],
      ),
    ).not.toThrow()
  })

  it('keeps strict MP3 role/order checks and requires AAC output to have no artwork', () => {
    expect(() =>
      assertCoverReadback(
        'mp3',
        [{ format: 'image/png', data: new Uint8Array(3) }],
        [frontPng],
      ),
    ).toThrow('顺序、类型或字节大小')
    expect(() =>
      assertCoverReadback('aac', [{ format: 'image/png', data: new Uint8Array(3) }], []),
    ).toThrow('意外保留了内嵌封面')
  })

  it('uses configured container and codec checks instead of output-format branches', () => {
    const m4aPlan: ExportPlan = {
      ...plan(),
      format: 'm4a',
      requestedExtension: 'm4a',
      resolvedFormat: 'm4a',
      outputFileName: 'output.m4a',
      requiresTranscode: true,
    }
    expect(() =>
      assertOutputProbe(m4aPlan, {
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
        streams: [{ codec_type: 'audio', codec_name: 'aac' }],
      }),
    ).not.toThrow()

    const aacPlan: ExportPlan = {
      ...m4aPlan,
      format: 'aac',
      requestedExtension: 'aac',
      resolvedFormat: 'aac',
      outputFileName: 'output.aac',
      requiresTranscode: false,
    }
    expect(() =>
      assertOutputProbe(aacPlan, {
        format: { format_name: 'aac' },
        streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
      }),
    ).toThrow('音频编码')
  })
})
