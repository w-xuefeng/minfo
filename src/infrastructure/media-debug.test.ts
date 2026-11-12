import { describe, expect, it } from 'vitest'

import { isExpectedMuxingQueueDelay, isMediaDebugEnabled } from './media-debug'

describe('isMediaDebugEnabled', () => {
  it('only enables supported truthy values during development', () => {
    expect(isMediaDebugEnabled(true, '1')).toBe(true)
    expect(isMediaDebugEnabled(true, ' TRUE ')).toBe(true)
    expect(isMediaDebugEnabled(true, 'on')).toBe(true)
    expect(isMediaDebugEnabled(true, 'yes')).toBe(true)
  })

  it('stays disabled for production or unsupported values', () => {
    expect(isMediaDebugEnabled(false, '1')).toBe(false)
    expect(isMediaDebugEnabled(false, 'true')).toBe(false)
    expect(isMediaDebugEnabled(true, undefined)).toBe(false)
    expect(isMediaDebugEnabled(true, '0')).toBe(false)
    expect(isMediaDebugEnabled(true, 'debug')).toBe(false)
  })

  it('recognizes the repeated attached-picture muxing queue notice as informational', () => {
    expect(
      isExpectedMuxingQueueDelay(
        'ffmpeg',
        'stdout',
        'Delay between the first packet and last packet in the muxing queue is 10008000 > 10000000: forcing output',
      ),
    ).toBe(true)
    expect(
      isExpectedMuxingQueueDelay(
        'ffprobe',
        'stdout',
        'Delay between the first packet and last packet in the muxing queue is 10008000 > 10000000: forcing output',
      ),
    ).toBe(false)
  })
})
