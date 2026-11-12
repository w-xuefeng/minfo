import { describe, expect, it } from 'vitest'

import { buildExportPlan, needsConfirmation } from './export-planner'
import { emptyDraft } from '@/domain/model'
import type { QueueItem, RuntimeStatus } from '@/domain/model'

const runtime: RuntimeStatus = {
  state: 'ready',
  version: 'test-runtime',
  message: 'ready',
}

const item = (overrides: Partial<QueueItem> = {}): QueueItem => {
  const file = new File(['audio'], 'source.m4a', { type: 'audio/mp4', lastModified: 1 })
  return {
    id: 'item-1',
    file,
    identity: { name: 'source.m4a', size: file.size, lastModified: 1 },
    status: 'ready',
    draft: emptyDraft(),
    originalDraft: emptyDraft(),
    technical: {
      extension: 'm4a',
      mime: 'audio/mp4',
      container: 'M4A',
      codec: 'ALAC',
      lossless: true,
      tagTypes: ['iTunes'],
    },
    nativeTags: [],
    warnings: [],
    draftRevision: 4,
    createdAt: 1,
    ...overrides,
  }
}

describe('buildExportPlan', () => {
  it('requires explicit confirmation for lossless M4A to MP3', () => {
    const plan = buildExportPlan(
      item(),
      {
        format: 'mp3',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.runnable).toBe(true)
    expect(plan.requiresTranscode).toBe(true)
    expect(plan.risks.map((risk) => risk.id)).toContain('lossless-to-lossy')
    expect(needsConfirmation(plan)).toBe(true)
    expect(plan.outputFileName).toBe('output.mp3')
  })

  it('uses raw ADTS AAC for the AAC choice', () => {
    const plan = buildExportPlan(
      item(),
      {
        format: 'aac',
        quality: 'balanced',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.requestedExtension).toBe('aac')
    expect(plan.resolvedFormat).toBe('aac')
    expect(plan.requiresTranscode).toBe(true)
    expect(plan.outputFileName).toBe('output.aac')
  })

  it('recognizes an ADTS AAC source and permits its original-format plan', () => {
    const aac = item({
      identity: { name: 'source.aac', size: 5, lastModified: 1 },
      technical: {
        extension: 'aac',
        mime: 'audio/aac',
        container: 'ADTS/MPEG-4',
        codec: 'AAC',
        tagTypes: ['ID3v2.4'],
      },
    })
    const plan = buildExportPlan(
      aac,
      {
        format: 'original',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.resolvedFormat).toBe('aac')
    expect(plan.outputFileName).toBe('output.aac')
    expect(plan.requiresTranscode).toBe(false)
    expect(plan.runnable).toBe(true)
  })

  it('requires acknowledgement before AAC output omits covers from the new copy', () => {
    const draft = {
      ...emptyDraft(),
      covers: [
        {
          id: 'cover-1',
          kind: 'front' as const,
          mime: 'image/jpeg',
          size: 3,
          source: 'replacement' as const,
        },
      ],
    }
    const plan = buildExportPlan(
      item({ draft, originalDraft: draft }),
      {
        format: 'aac',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.runnable).toBe(true)
    expect(plan.risks.find((risk) => risk.id === 'aac-cover-omitted')).toMatchObject({
      requiresConfirmation: true,
    })
  })

  it('does not invent a target for unsupported source formats', () => {
    const unsupported = item({
      identity: { name: 'source.flac', size: 5, lastModified: 1 },
      technical: {
        extension: 'flac',
        mime: 'audio/flac',
        container: 'FLAC',
        codec: 'FLAC',
        tagTypes: ['Vorbis'],
      },
    })
    const plan = buildExportPlan(
      unsupported,
      {
        format: 'original',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.resolvedFormat).toBeNull()
    expect(plan.runnable).toBe(false)
    expect(plan.outputFileName).toBe('output.flac')
  })

  it('allows an unverified input to attempt a selected supported target after acknowledgement', () => {
    const unsupported = item({
      identity: { name: 'source.flac', size: 5, lastModified: 1 },
      technical: {
        extension: 'flac',
        mime: 'audio/flac',
        container: 'FLAC',
        codec: 'FLAC',
        tagTypes: ['Vorbis'],
      },
    })
    const plan = buildExportPlan(
      unsupported,
      {
        format: 'mp3',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.runnable).toBe(true)
    expect(plan.requiresTranscode).toBe(true)
    expect(plan.risks.find((risk) => risk.id === 'unsupported-source')).toMatchObject({
      requiresConfirmation: true,
    })
  })

  it('does not trust an MP3 extension after inspection identifies a different container', () => {
    const misleading = item({
      identity: { name: 'actually-flac.mp3', size: 5, lastModified: 1 },
      technical: {
        extension: 'mp3',
        mime: 'audio/mpeg',
        container: 'FLAC',
        codec: 'FLAC',
        tagTypes: ['Vorbis'],
      },
    })

    const plan = buildExportPlan(
      misleading,
      {
        format: 'original',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.resolvedFormat).toBeNull()
    expect(plan.runnable).toBe(false)
  })

  it('recognizes music-metadata MPEG and MPEG-4 container names without trusting extensions', () => {
    const mpeg = item({
      identity: { name: 'renamed.bin', size: 5, lastModified: 1 },
      technical: {
        extension: 'bin',
        mime: 'application/octet-stream',
        container: 'MPEG',
        codec: 'MPEG 1 Layer 3',
        tagTypes: ['ID3v2.4'],
      },
    })
    const mpeg4 = item({
      identity: { name: 'renamed.data', size: 5, lastModified: 1 },
      technical: {
        extension: 'data',
        mime: 'application/octet-stream',
        container: 'MPEG-4',
        codec: 'AAC',
        tagTypes: ['iTunes'],
      },
    })
    const request = {
      format: 'original' as const,
      quality: 'high' as const,
      outputBaseName: 'output',
      allowOverwrite: false,
    }

    expect(buildExportPlan(mpeg, request, runtime).resolvedFormat).toBe('mp3')
    expect(buildExportPlan(mpeg, request, runtime).outputFileName).toBe('output.mp3')
    expect(buildExportPlan(mpeg4, request, runtime).resolvedFormat).toBe('m4a')
    expect(buildExportPlan(mpeg4, request, runtime).outputFileName).toBe('output.m4a')
  })

  it('requires acknowledgement before omitting an embedded cover without a proven stream mapping', () => {
    const original = {
      ...emptyDraft(),
      covers: [
        {
          id: 'cover-1',
          kind: 'front' as const,
          mime: 'image/jpeg',
          size: 3,
          source: 'embedded' as const,
        },
      ],
    }
    const request = {
      format: 'original' as const,
      quality: 'high' as const,
      outputBaseName: 'x',
      allowOverwrite: false,
    }
    const blocked = buildExportPlan(
      item({ draft: original, originalDraft: original }),
      request,
      runtime,
    )
    const mapped = buildExportPlan(
      item({
        draft: { ...original, covers: [{ ...original.covers[0]!, sourceIndex: 0 }] },
        originalDraft: { ...original, covers: [{ ...original.covers[0]!, sourceIndex: 0 }] },
      }),
      request,
      runtime,
    )

    expect(blocked.runnable).toBe(true)
    expect(blocked.risks.find((risk) => risk.id === 'unmapped-cover-omitted')).toMatchObject({
      requiresConfirmation: true,
    })
    expect(mapped.runnable).toBe(true)
  })

  it('requires acknowledgement for an incomplete input probe but keeps browser export runnable', () => {
    const plan = buildExportPlan(
      item({ browserExportWarning: 'FFprobe could not verify attached pictures.' }),
      {
        format: 'original',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.runnable).toBe(true)
    expect(plan.risks.find((risk) => risk.id === 'probe-incomplete')).toMatchObject({
      requiresConfirmation: true,
    })
  })

  it('requires acknowledgement for source SYLT but allows a new-copy export', () => {
    const plan = buildExportPlan(
      item({ nativeTags: [{ type: 'ID3v2.4', id: 'SYLT:eng', value: 'synchronised lyrics' }] }),
      {
        format: 'original',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.runnable).toBe(true)
    expect(plan.risks.find((risk) => risk.id === 'sylt-copy-uncertain')).toMatchObject({
      requiresConfirmation: true,
    })
    expect(plan.summary).toContain('我已知晓，坚持导出')
  })

  it('identifies a synchronised lyric alias inside an ID3 user-text key', () => {
    const plan = buildExportPlan(
      item({
        nativeTags: [{ type: 'ID3v2.4', id: 'TXXX:SYLT', value: 'synchronised lyrics' }],
      }),
      {
        format: 'original',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.risks.find((risk) => risk.id === 'sylt-copy-uncertain')).toMatchObject({
      requiresConfirmation: true,
    })
  })

  it('asks before normalizing imported lyrics even when the slot form is unchanged', () => {
    const originalDraft = {
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
    const plan = buildExportPlan(
      item({ originalDraft, draft: originalDraft }),
      {
        format: 'original',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.risks.find((risk) => risk.id === 'lyrics-slot-compatibility')).toMatchObject({
      requiresConfirmation: true,
    })
  })

  it('turns duplicate advanced-tag writes into an acknowledgement gate rather than a block', () => {
    const originalDraft = {
      ...emptyDraft(),
      rawTags: [
        { id: 'one', key: 'TXXX', value: 'first' },
        { id: 'two', key: 'TXXX', value: 'second' },
      ],
    }
    const plan = buildExportPlan(
      item({
        originalDraft,
        draft: {
          ...originalDraft,
          rawTags: [
            { ...originalDraft.rawTags[0]!, value: 'changed' },
            originalDraft.rawTags[1]!,
          ],
        },
      }),
      {
        format: 'original',
        quality: 'high',
        outputBaseName: 'output',
        allowOverwrite: false,
      },
      runtime,
    )

    expect(plan.runnable).toBe(true)
    expect(plan.risks.find((risk) => risk.id === 'raw-tag-duplicate-slot')).toMatchObject({
      requiresConfirmation: true,
    })
  })
})
