import { describe, expect, it } from 'vitest'

import { browserOutputFormatIds } from './audio-formats'
import {
  coversOmittedByOutput,
  isCoverEmbeddableInOutput,
  outputDropsCoverRoleSemantics,
  outputVerificationCapabilitiesByFormat,
  outputVerificationCapabilityFor,
  shouldVerifyOutputAudioCodec,
  shouldVerifyRawTagsExactly,
} from './output-verification-capabilities'

describe('output verification capabilities', () => {
  it('requires an explicit output verification contract for every browser target', () => {
    for (const format of browserOutputFormatIds) {
      const capability = outputVerificationCapabilityFor(format)
      expect(capability).toBe(outputVerificationCapabilitiesByFormat[format])
      expect(capability.probe.acceptedContainerNames.length).toBeGreaterThan(0)
      expect(capability.standardMetadata.multiValueSeparator.trim()).not.toBe('')
      expect(capability.covers.allowUnmappedSourceVisualStreamCopy).toBe(false)

      if (capability.covers.write === 'omitted') {
        expect(capability.covers.comparison).toBe('must-be-empty')
        expect(capability.covers.embeddableMimes).toEqual([])
        expect(capability.covers.omissionDescription?.trim()).not.toBe('')
      } else {
        expect(capability.covers.comparison).not.toBe('must-be-empty')
      }
    }
  })

  it('records M4A covr as a PNG/JPEG image collection without ID3 role or ordering', () => {
    const capability = outputVerificationCapabilityFor('m4a')

    expect(capability.covers).toMatchObject({
      write: 'embedded',
      comparison: 'unordered-mime-size',
      roleReadback: 'implicit-front-when-single',
      embeddableMimes: ['image/png', 'image/jpeg'],
    })
    expect(isCoverEmbeddableInOutput('m4a', { mime: 'image/jpg' })).toBe(true)
    expect(isCoverEmbeddableInOutput('m4a', { mime: 'image/webp' })).toBe(false)
    expect(
      coversOmittedByOutput('m4a', [
        { mime: 'image/png' },
        { mime: 'image/gif' },
        { mime: 'image/webp' },
      ]),
    ).toEqual([{ mime: 'image/gif' }, { mime: 'image/webp' }])
    expect(outputDropsCoverRoleSemantics('m4a', [{ kind: 'front' }])).toBe(false)
    expect(outputDropsCoverRoleSemantics('m4a', [{ kind: 'back' }])).toBe(true)
    expect(outputDropsCoverRoleSemantics('m4a', [{ kind: 'front' }, { kind: 'back' }])).toBe(
      true,
    )
  })

  it('keeps strict MP3 artwork semantics but declares AAC artwork absent', () => {
    expect(outputVerificationCapabilityFor('mp3').covers).toMatchObject({
      comparison: 'ordered-mime-size-kind',
      roleReadback: 'exact',
    })
    expect(outputDropsCoverRoleSemantics('mp3', [{ kind: 'back' }])).toBe(false)
    expect(coversOmittedByOutput('aac', [{ mime: 'image/jpeg' }])).toEqual([
      { mime: 'image/jpeg' },
    ])
    expect(outputVerificationCapabilityFor('aac').covers).toMatchObject({
      write: 'omitted',
      comparison: 'must-be-empty',
    })
  })

  it('limits raw-tag exact checks to same-container paths and drives codec checks from policy', () => {
    for (const format of browserOutputFormatIds) {
      expect(shouldVerifyRawTagsExactly(format, false)).toBe(true)
      expect(shouldVerifyRawTagsExactly(format, true)).toBe(false)
    }
    expect(shouldVerifyOutputAudioCodec('mp3', false)).toBe(false)
    expect(shouldVerifyOutputAudioCodec('mp3', true)).toBe(true)
    expect(shouldVerifyOutputAudioCodec('m4a', false)).toBe(false)
    expect(shouldVerifyOutputAudioCodec('m4a', true)).toBe(true)
    expect(shouldVerifyOutputAudioCodec('aac', false)).toBe(true)
    expect(shouldVerifyOutputAudioCodec('aac', true)).toBe(true)
  })
})
