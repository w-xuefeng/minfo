import { describe, expect, it } from 'vitest'

import {
  browserAudioFormatList,
  browserAudioFormats,
  browserExportFormatOptions,
  browserFallbackFormat,
  browserOutputFormatIds,
  getBrowserAudioFormat,
  isBrowserOutputFormat,
  localFfmpegFormatOptions,
} from './audio-formats'

describe('browser audio format catalogue', () => {
  it('uses one ordered catalogue for browser-visible output options', () => {
    expect(browserAudioFormatList.map((format) => format.id)).toEqual(browserOutputFormatIds)
    expect(browserExportFormatOptions.map((option) => option.id)).toEqual([
      'original',
      ...browserOutputFormatIds,
    ])
  })

  it('keeps each stable output definition complete', () => {
    for (const format of browserOutputFormatIds) {
      const definition = getBrowserAudioFormat(format)
      expect(definition).toBe(browserAudioFormats[format])
      expect(definition.outputExtension).toMatch(/^[a-z0-9]+$/)
      expect(definition.mimeType).toMatch(/^audio\//)
      expect(definition.label).not.toBe('')
      expect(definition.containerDescription).not.toBe('')
    }
  })

  it('recognises only configured browser output IDs', () => {
    expect(isBrowserOutputFormat('aac')).toBe(true)
    expect(isBrowserOutputFormat('flac')).toBe(false)
  })

  it('derives the browser fallback and local-command options from the catalogue', () => {
    expect(browserOutputFormatIds).toContain(browserFallbackFormat.id)
    expect(localFfmpegFormatOptions.map((option) => option.id)).toEqual([
      'use-plan',
      ...browserOutputFormatIds,
      'flac',
      'wav',
      'ogg',
      'wma',
      'ape',
      'amr',
      'mid',
      'alac',
      'oga',
      'custom',
    ])
  })
})
