import { describe, expect, it } from 'vitest'

import { browserOutputFormatIds } from './audio-formats'
import {
  disabledEditableMetadataFields,
  editableFormCapabilitiesByFormat,
  editableMetadataFormFields,
  formCapabilitiesForOutput,
} from './editable-form-capabilities'

describe('editable metadata form capabilities', () => {
  it('requires a complete editable-field map for every browser output format', () => {
    for (const format of browserOutputFormatIds) {
      const capabilities = editableFormCapabilitiesByFormat[format]
      expect(Object.keys(capabilities).sort()).toEqual([...editableMetadataFormFields].sort())
      for (const field of editableMetadataFormFields) {
        const capability = capabilities[field]
        if (capability.editable) {
          expect(capability.disabledReason).toBeUndefined()
        } else {
          expect(capability.disabledReason?.trim()).not.toBe('')
        }
      }
    }
  })

  it('uses the AAC configuration to disable only cover editing', () => {
    const capabilities = formCapabilitiesForOutput('aac')

    expect(disabledEditableMetadataFields(capabilities)).toEqual(['covers'])
    expect(capabilities.covers.disabledReason).toContain('ADTS AAC')
    expect(capabilities.title.editable).toBe(true)
    expect(capabilities.lyrics.editable).toBe(true)
  })

  it('keeps forms editable until an output target can be resolved', () => {
    expect(disabledEditableMetadataFields(formCapabilitiesForOutput(null))).toEqual([])
  })
})
