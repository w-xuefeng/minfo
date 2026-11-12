import { describe, expect, it } from 'vitest'

import {
  formatOutputFileName,
  getRequestedOutputExtension,
  getResolvedFormat,
  isStableFormat,
} from './format'
import { exportFormatOptions } from './model'

describe('output format requests', () => {
  it('never puts path syntax in a generated filename', () => {
    expect(formatOutputFileName('source', '../unsafe')).toBe('source.audio')
  })

  it('models AAC as an ADTS .aac browser output request', () => {
    expect(getRequestedOutputExtension({ format: 'aac' }, 'source.mp3')).toBe('aac')
    expect(getResolvedFormat('aac')).toBe('aac')
    expect(isStableFormat('aac')).toBe(true)
    expect(isStableFormat('flac')).toBe(false)
  })

  it('exposes only the first-release browser output matrix', () => {
    expect(exportFormatOptions).toEqual(['original', 'mp3', 'm4a', 'aac'])
  })
})
