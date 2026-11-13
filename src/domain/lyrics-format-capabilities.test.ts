import { describe, expect, it } from 'vitest'

import { browserOutputFormatIds } from './audio-formats'
import {
  lyricsFormatCapabilitiesByFormat,
  lyricsFormatCapabilityFor,
  lyricsFormatFieldIds,
} from './lyrics-format-capabilities'

describe('lyrics output format capabilities', () => {
  it('requires an explicit lyrics field contract for every browser output format', () => {
    for (const format of browserOutputFormatIds) {
      const capability = lyricsFormatCapabilityFor(format)
      expect(capability).toBe(lyricsFormatCapabilitiesByFormat[format])
      expect(Object.keys(capability.fields).sort()).toEqual([...lyricsFormatFieldIds].sort())

      for (const field of lyricsFormatFieldIds) {
        const contract = capability.fields[field]
        expect(contract.metadataKeyTemplate).not.toBe('')
        if (contract.verify) expect(contract.write).toBe(true)
        if (!contract.write) {
          expect(contract.unsupportedDescription?.trim()).not.toBe('')
        }
      }
    }
  })

  it('records M4A as a primary-lyrics-only target while MP3 and ADTS AAC retain all slot fields', () => {
    const m4a = lyricsFormatCapabilityFor('m4a')

    expect(m4a.fields.primaryText).toMatchObject({ write: true, verify: true })
    expect(m4a.fields.primaryLanguage).toMatchObject({ write: false, verify: false })
    expect(m4a.fields.additionalLanguageSlots).toMatchObject({ write: false, verify: false })
    expect(m4a.manageSourceAliases).toBe(false)
    expect(m4a.verifyParsedLanguageManifest).toBe(false)

    for (const format of ['mp3', 'aac'] as const) {
      const capability = lyricsFormatCapabilityFor(format)
      expect(capability.fields.primaryText).toMatchObject({ write: true, verify: true })
      expect(capability.fields.primaryLanguage).toMatchObject({ write: true, verify: true })
      expect(capability.fields.additionalLanguageSlots).toMatchObject({
        write: true,
        verify: true,
      })
      expect(capability.manageSourceAliases).toBe(true)
      expect(capability.verifyParsedLanguageManifest).toBe(true)
    }
  })
})
