import { describe, expect, it } from 'vitest'

import { parseLyricsPreview } from './lrc'

describe('parseLyricsPreview', () => {
  it('keeps each valid timestamp as its own timeline event', () => {
    const preview = parseLyricsPreview('[00:12.34][01:02.003]chorus\n[ar:Artist]\nplain line')

    expect(preview.mode).toBe('mixed')
    expect(preview.events).toEqual([
      { line: 0, milliseconds: 12_340, timeLabel: '00:12.340', text: 'chorus' },
      { line: 0, milliseconds: 62_003, timeLabel: '01:02.003', text: 'chorus' },
    ])
    expect(preview.unmarkedLines).toEqual(['[ar:Artist]', 'plain line'])
  })

  it('does not treat invalid seconds as a valid LRC timestamp', () => {
    const preview = parseLyricsPreview('[01:60]not a valid timestamp')

    expect(preview.mode).toBe('plain')
    expect(preview.events).toEqual([])
    expect(preview.plainLines).toEqual(['[01:60]not a valid timestamp'])
  })
})
