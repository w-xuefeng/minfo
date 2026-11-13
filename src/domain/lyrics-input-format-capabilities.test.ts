import { describe, expect, it } from 'vitest'

import {
  lyricsInputCapabilityForSource,
  lyricsInputFormatCapabilities,
  lyricsInputFormatIds,
} from './lyrics-input-format-capabilities'

describe('lyrics input format capabilities', () => {
  it('declares a non-generic import contract for every supported source family', () => {
    for (const id of lyricsInputFormatIds) {
      const capability = lyricsInputFormatCapabilities[id]
      expect(capability.id).toBe(id)
      expect(capability.nativeLyricsAliases.length).toBeGreaterThan(0)
      for (const alias of capability.nativeLyricsAliases) {
        expect(alias.name.trim()).not.toBe('')
      }
      if (capability.maximumSlots !== undefined) {
        expect(capability.maximumSlots).toBeGreaterThan(0)
        expect(capability.maximumSlotsWarning?.trim()).not.toBe('')
      }
    }
  })

  it('selects source profiles from parser container and codec evidence, not an extension', () => {
    expect(
      lyricsInputCapabilityForSource({
        container: 'MPEG',
        codec: 'MPEG 1 Layer 3',
        tagTypes: ['ID3v2.4'],
      }).id,
    ).toBe('mp3')
    expect(
      lyricsInputCapabilityForSource({
        container: 'MPEG-4',
        codec: 'ALAC',
        tagTypes: ['iTunes'],
      }).id,
    ).toBe('m4a')
    expect(
      lyricsInputCapabilityForSource({
        container: 'ADTS/MPEG-4',
        codec: 'AAC',
        tagTypes: ['ID3v2.4'],
      }).id,
    ).toBe('aac')
    expect(lyricsInputCapabilityForSource({ container: 'FLAC', codec: 'FLAC' }).id).toBe(
      'generic',
    )
  })

  it('can use tag-family evidence only when a parser omits the container label', () => {
    expect(
      lyricsInputCapabilityForSource({
        codec: 'AAC',
        tagTypes: ['ID3v2.4'],
        nativeTagTypes: ['ID3v2.4'],
      }).id,
    ).toBe('aac')
    expect(
      lyricsInputCapabilityForSource({
        codec: 'ALAC',
        tagTypes: ['iTunes'],
        nativeTagTypes: ['iTunes'],
      }).id,
    ).toBe('m4a')
    expect(lyricsInputCapabilityForSource({ codec: 'AAC' }).id).toBe('generic')
  })

  it('keeps M4A source reading to one unlabelled ©lyr slot', () => {
    const m4a = lyricsInputCapabilityForSource({ container: 'MPEG-4', codec: 'AAC' })

    expect(m4a.nativeLyricsAliases).toEqual([
      { name: '©lyr', representation: 'plain', acceptsLanguageSuffix: false },
    ])
    expect(m4a.languageDeclarationAliases).toEqual([])
    expect(m4a.commonLyricsLanguage).toBe('und')
    expect(m4a.maximumSlots).toBe(1)
  })
})
