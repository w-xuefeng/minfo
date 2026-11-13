import { describe, expect, it } from 'vitest'

import { emptyDraft } from '@/domain/model'

import {
  buildFfmpegArguments,
  buildMetadataArguments,
  exportableCovers,
  survivingCovers,
} from './ffmpeg-arguments'
import type { ExportPlan } from '@/domain/model'

const plan: ExportPlan = {
  sourceIdentity: { name: 'source.mp3', size: 1, lastModified: 1 },
  draftRevision: 0,
  format: 'original',
  requestedExtension: 'mp3',
  resolvedFormat: 'mp3',
  outputFileName: 'source (MINFO).mp3',
  quality: 'high',
  requiresTranscode: false,
  engine: 'browser-runtime',
  runnable: true,
  summary: 'test',
  risks: [],
  runtimeVersion: 'test',
}

describe('survivingCovers', () => {
  it('omits an embedded cover that was replaced instead of mapping it twice', () => {
    const original = {
      ...emptyDraft(),
      covers: [
        {
          id: 'embedded-0',
          kind: 'front' as const,
          mime: 'image/jpeg',
          size: 1,
          source: 'embedded' as const,
        },
        {
          id: 'embedded-1',
          kind: 'back' as const,
          mime: 'image/jpeg',
          size: 1,
          source: 'embedded' as const,
        },
      ],
    }
    const draft = {
      ...original,
      covers: [
        {
          id: 'new-front',
          replacesId: 'embedded-0',
          kind: 'front' as const,
          mime: 'image/png',
          size: 1,
          source: 'replacement' as const,
        },
        original.covers[1]!,
      ],
    }

    expect(survivingCovers(draft, original).map((cover) => cover.id)).toEqual([
      'new-front',
      'embedded-1',
    ])
  })

  it('copies a retained embedded cover even when no replacement image is an input', () => {
    const original = {
      ...emptyDraft(),
      covers: [
        {
          id: 'embedded-0',
          kind: 'front' as const,
          mime: 'image/jpeg',
          size: 1,
          source: 'embedded' as const,
          sourceIndex: 0,
        },
      ],
    }

    const argumentsList = buildFfmpegArguments(plan, original, original, {
      source: 'input.mp3',
      covers: [],
      output: 'output.mp3',
    })

    expect(argumentsList).toContain('-nostdin')
    expect(argumentsList).toContain('0:v:0?')
    expect(argumentsList).toContain('-c:v')
    expect(argumentsList).toContain('copy')
  })

  it('uses an ADTS container and ID3v2 tags for AAC output', () => {
    const aacPlan: ExportPlan = {
      ...plan,
      format: 'aac',
      requestedExtension: 'aac',
      resolvedFormat: 'aac',
      outputFileName: 'source (MINFO).aac',
      requiresTranscode: true,
    }

    expect(
      buildFfmpegArguments(aacPlan, emptyDraft(), emptyDraft(), {
        source: 'input.mp3',
        covers: [],
        output: 'output.aac',
      }),
    ).toEqual(
      expect.arrayContaining(['-c:a', 'aac', '-f', 'adts', '-write_id3v2', '1', 'output.aac']),
    )
  })

  it('uses the M4A lyrics capability instead of emitting ID3-style language helpers', () => {
    const m4aPlan: ExportPlan = {
      ...plan,
      format: 'm4a',
      requestedExtension: 'm4a',
      resolvedFormat: 'm4a',
      outputFileName: 'source (MINFO).m4a',
      requiresTranscode: true,
    }
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

    const argumentsList = buildFfmpegArguments(
      m4aPlan,
      draft,
      emptyDraft(),
      {
        source: 'input.mp3',
        covers: [],
        output: 'output.m4a',
      },
      {
        managedLyricsSourceTagKeys: ['TXXX:lyrics_language', 'TXXX:lyrics-eng'],
      },
    )

    expect(argumentsList).toContain('lyrics=中文歌词')
    expect(argumentsList).not.toContain('lyrics_language=')
    expect(argumentsList).not.toContain('lyrics-eng=')
    expect(argumentsList).not.toContain('TXXX:lyrics_language=')
    expect(argumentsList).not.toContain('TXXX:lyrics-eng=')
    expect(argumentsList).not.toContain('lyrics_language=zho')
    expect(argumentsList).not.toContain('lyrics-eng=English lyrics')
  })

  it('omits covers from an AAC copy instead of rejecting the plan', () => {
    const aacPlan: ExportPlan = {
      ...plan,
      format: 'aac',
      requestedExtension: 'aac',
      resolvedFormat: 'aac',
      outputFileName: 'source (MINFO).aac',
      requiresTranscode: true,
    }
    const draft = {
      ...emptyDraft(),
      covers: [
        {
          id: 'cover-1',
          kind: 'front' as const,
          mime: 'image/jpeg',
          size: 1,
          source: 'replacement' as const,
        },
      ],
    }

    const argumentsList = buildFfmpegArguments(aacPlan, draft, emptyDraft(), {
      source: 'input.mp3',
      covers: ['cover.jpg'],
      output: 'output.aac',
    })

    expect(exportableCovers(aacPlan, draft, emptyDraft())).toEqual([])
    expect(argumentsList).not.toContain('cover.jpg')
    expect(argumentsList).not.toContain('0:v:0?')
  })

  it('omits an unmapped embedded cover but keeps a mapped one in the new copy', () => {
    const draft = {
      ...emptyDraft(),
      covers: [
        {
          id: 'unmapped',
          kind: 'front' as const,
          mime: 'image/jpeg',
          size: 1,
          source: 'embedded' as const,
        },
        {
          id: 'mapped',
          kind: 'back' as const,
          mime: 'image/png',
          size: 1,
          source: 'embedded' as const,
          sourceIndex: 1,
        },
      ],
    }

    expect(exportableCovers(plan, draft, draft).map((cover) => cover.id)).toEqual(['mapped'])
  })

  it('still builds a best-effort command for a confirmed duplicate raw-tag change', () => {
    const original = {
      ...emptyDraft(),
      rawTags: [
        { id: 'one', key: 'TXXX', value: 'first' },
        { id: 'two', key: 'TXXX', value: 'second' },
      ],
    }
    const draft = {
      ...original,
      rawTags: [{ ...original.rawTags[0]!, value: 'changed' }, original.rawTags[1]!],
    }

    expect(() =>
      buildFfmpegArguments(plan, draft, original, {
        source: 'input.mp3',
        covers: [],
        output: 'output.mp3',
      }),
    ).not.toThrow()
  })

  it('replaces managed source lyric aliases with the current slot manifest', () => {
    const original = {
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
    const draft = { ...original, lyricsSlots: [original.lyricsSlots[0]!] }

    const argumentsList = buildMetadataArguments(draft, original, {
      managedLyricsSourceTagKeys: ['TXXX:lyrics-eng', 'TXXX:lyrics_language'],
    })

    expect(argumentsList).toEqual(
      expect.arrayContaining([
        '-metadata',
        'TXXX:lyrics-eng=',
        '-metadata',
        'TXXX:lyrics_language=',
        '-metadata',
        'lyrics=中文歌词',
        '-metadata',
        'lyrics_language=zho',
        '-metadata',
        'lyrics-eng=',
      ]),
    )
    expect(argumentsList.indexOf('TXXX:lyrics-eng=')).toBeLessThan(
      argumentsList.indexOf('lyrics=中文歌词'),
    )
  })

  it('materializes lyrics from slots even when the user has not edited them', () => {
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

    expect(
      buildMetadataArguments(draft, draft, {
        managedLyricsSourceTagKeys: ['TXXX:USLT'],
      }),
    ).toEqual(
      expect.arrayContaining([
        '-metadata',
        'TXXX:USLT=',
        '-metadata',
        'lyrics=',
        '-metadata',
        'lyrics=中文歌词',
      ]),
    )
  })

  it('clears the language-qualified key that FFmpeg derives from a primary ID3 lyric', () => {
    const original = {
      ...emptyDraft(),
      lyricsSlots: [
        {
          id: 'eng',
          language: 'eng',
          descriptor: '',
          representation: 'plain' as const,
          text: 'English lyrics',
        },
      ],
    }
    const draft = {
      ...original,
      lyricsSlots: [
        {
          ...original.lyricsSlots[0]!,
          language: 'zho',
          text: '中文歌词',
        },
      ],
    }

    expect(buildMetadataArguments(draft, original)).toEqual(
      expect.arrayContaining(['-metadata', 'lyrics-eng=', '-metadata', 'lyrics-zho=']),
    )
  })
})
