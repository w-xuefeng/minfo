import { describe, expect, it } from 'vitest'

import { hasUnfilledLocalPaths, renderFfmpegCommand } from './ffmpeg-command'
import { emptyDraft } from '@/domain/model'
import type { ExportPlan } from '@/domain/model'

const plan: ExportPlan = {
  sourceIdentity: { name: 'source.mp3', size: 12, lastModified: 4 },
  draftRevision: 3,
  format: 'm4a',
  requestedExtension: 'm4a',
  resolvedFormat: 'm4a',
  outputFileName: 'source (MINFO).m4a',
  quality: 'high',
  requiresTranscode: true,
  engine: 'browser-runtime',
  runnable: true,
  summary: 'test',
  risks: [],
  runtimeVersion: 'test',
}

describe('renderFfmpegCommand', () => {
  it('uses safe POSIX declarations and fails before placeholders reach FFmpeg', () => {
    const script = renderFfmpegCommand({
      dialect: 'posix',
      plan,
      draft: { ...emptyDraft(), title: "A title with ' quote" },
      originalDraft: emptyDraft(),
      sourceName: 'source.mp3',
      customFormat: '',
      allowOverwrite: false,
      paths: {
        sourcePath: "/music/it's source.mp3",
        outputPath: '',
        coverPaths: {},
      },
    })

    expect(script).toContain("SOURCE_PATH='/music/it'\"'\"'s source.mp3'")
    expect(script).toContain("'-metadata' 'title=A title with '\"'\"' quote'")
    expect(script).toContain("require_path 'OUTPUT_PATH'")
    expect(script).toContain('ffmpeg -n')
    expect(script).toContain("'-nostdin'")
    expect(script).toContain('output path must end in')
    expect(script).toContain('ffprobe -v error')
  })

  it('renders a PowerShell script without executable interpolation', () => {
    const script = renderFfmpegCommand({
      dialect: 'powershell',
      plan,
      draft: emptyDraft(),
      originalDraft: emptyDraft(),
      sourceName: 'source.mp3',
      customFormat: 'flac',
      allowOverwrite: true,
      paths: { sourcePath: '', outputPath: '', coverPaths: {} },
    })

    expect(script).toContain("$SourcePath = '__MINFO_SOURCE_PATH__'")
    expect(script).toContain('& ffmpeg -y')
    expect(script).not.toContain("'-c:a' 'aac'")
    expect(script).toContain('$OutputPath')
    expect(script).toContain('Assert-MinfoPath')
    expect(script).toContain('ConvertFrom-Json')
    expect(script).toContain('$LASTEXITCODE -ne 0')
  })

  it('rejects NUL characters before rendering a local command', () => {
    expect(() =>
      renderFfmpegCommand({
        dialect: 'posix',
        plan,
        draft: { ...emptyDraft(), title: 'not\u0000safe' },
        originalDraft: emptyDraft(),
        sourceName: 'source.mp3',
        customFormat: '',
        allowOverwrite: false,
        paths: { sourcePath: '', outputPath: '', coverPaths: {} },
      }),
    ).toThrow('NUL')
  })

  it('treats an invalid custom extension as incomplete instead of breaking the path helper', () => {
    expect(
      hasUnfilledLocalPaths({
        dialect: 'posix',
        plan,
        draft: emptyDraft(),
        originalDraft: emptyDraft(),
        sourceName: 'source.mp3',
        customFormat: 'not a valid extension!',
        allowOverwrite: false,
        paths: {
          sourcePath: '/music/source.mp3',
          outputPath: '/music/output.mp3',
          coverPaths: {},
        },
      }),
    ).toBe(true)
  })

  it('omits an unmapped embedded cover from a local new-copy script instead of blocking it', () => {
    const original = {
      ...emptyDraft(),
      covers: [
        {
          id: 'embedded',
          kind: 'front' as const,
          mime: 'image/jpeg',
          size: 1,
          source: 'embedded' as const,
        },
      ],
    }
    const script = renderFfmpegCommand({
      dialect: 'posix',
      plan,
      draft: { ...original, covers: [{ ...original.covers[0]!, kind: 'back' as const }] },
      originalDraft: original,
      sourceName: 'source.mp3',
      customFormat: '',
      allowOverwrite: false,
      paths: {
        sourcePath: '/music/source.mp3',
        outputPath: '/music/output.m4a',
        coverPaths: {},
      },
    })

    expect(script).not.toContain('cannot be mapped safely')
    expect(script).not.toContain("'0:v:0?'")
    expect(script).toContain('ffmpeg -n')
  })

  it('does not require a replacement-cover path for an AAC plan that omits covers', () => {
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
          id: 'replacement',
          kind: 'front' as const,
          mime: 'image/jpeg',
          size: 1,
          source: 'replacement' as const,
        },
      ],
    }
    const script = renderFfmpegCommand({
      dialect: 'posix',
      plan: aacPlan,
      draft,
      originalDraft: emptyDraft(),
      sourceName: 'source.mp3',
      customFormat: '',
      allowOverwrite: false,
      paths: {
        sourcePath: '/music/source.mp3',
        outputPath: '/music/output.aac',
        coverPaths: {},
      },
    })

    expect(script).not.toContain('COVER_1_PATH')
    expect(script).not.toContain('__MINFO_COVER_1__')
    expect(
      hasUnfilledLocalPaths({
        dialect: 'posix',
        plan: aacPlan,
        draft,
        originalDraft: emptyDraft(),
        sourceName: 'source.mp3',
        customFormat: '',
        allowOverwrite: false,
        paths: {
          sourcePath: '/music/source.mp3',
          outputPath: '/music/output.aac',
          coverPaths: {},
        },
      }),
    ).toBe(false)
  })

  it('renders a raw ADTS AAC browser plan with an AAC extension', () => {
    const script = renderFfmpegCommand({
      dialect: 'posix',
      plan: {
        ...plan,
        format: 'aac',
        requestedExtension: 'aac',
        resolvedFormat: 'aac',
        outputFileName: 'source (MINFO).aac',
        requiresTranscode: true,
      },
      draft: emptyDraft(),
      originalDraft: emptyDraft(),
      sourceName: 'source.mp3',
      customFormat: '',
      allowOverwrite: false,
      paths: {
        sourcePath: '/music/source.mp3',
        outputPath: '/music/output.aac',
        coverPaths: {},
      },
    })

    expect(script).toContain("'-c:a' 'aac'")
    expect(script).toContain("'-f' 'adts'")
    expect(script).toContain("'-write_id3v2' '1'")
    expect(script).toContain("EXPECTED_EXTENSION='aac'")
  })

  it('clears exact managed source lyric aliases in local scripts', () => {
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
    const script = renderFfmpegCommand({
      dialect: 'posix',
      plan,
      draft: { ...original, lyricsSlots: [original.lyricsSlots[0]!] },
      originalDraft: original,
      nativeTags: [{ type: 'ID3v2.4', id: 'TXXX:lyrics-eng', value: 'English lyrics' }],
      sourceName: 'source.mp3',
      customFormat: '',
      allowOverwrite: false,
      paths: { sourcePath: '', outputPath: '', coverPaths: {} },
    })

    expect(script).toContain("'-metadata' 'TXXX:lyrics-eng='")
    expect(script).toContain("'-metadata' 'lyrics-eng='")
    expect(script).toContain("'-metadata' 'lyrics=中文歌词'")
  })
})
