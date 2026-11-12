import { describe, expect, it } from 'vitest'

import { inspectCoverHeader } from './cover'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)

describe('inspectCoverHeader', () => {
  it('reads PNG dimensions from the signed header', () => {
    const header = bytes(
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
      0x49,
      0x48,
      0x44,
      0x52,
      0,
      0,
      0x03,
      0xe8,
      0,
      0,
      0x03,
      0xe8,
    )

    expect(inspectCoverHeader(header)).toEqual({ mime: 'image/png', width: 1000, height: 1000 })
  })

  it('recognizes GIF signatures and little-endian dimensions', () => {
    const header = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x02, 0xe0, 0x01)

    expect(inspectCoverHeader(header)).toEqual({ mime: 'image/gif', width: 640, height: 480 })
  })

  it('rejects an unrecognized or truncated image', () => {
    expect(inspectCoverHeader(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull()
    expect(inspectCoverHeader(bytes(0, 1, 2, 3, 4, 5))).toBeNull()
  })
})
