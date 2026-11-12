import { describe, expect, it } from 'vitest'

import { parseVerifiedFfprobeResult } from './ffprobe-result'

const verifiedMp3 = JSON.stringify({
  format: { format_name: 'mp3' },
  streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
})

describe('parseVerifiedFfprobeResult', () => {
  it('accepts verified JSON when the core wrapper reports its known -1 sentinel', () => {
    const result = parseVerifiedFfprobeResult(-1, verifiedMp3)

    expect(result).toMatchObject({
      container: 'mp3',
      audioCodec: 'mp3',
      exitCode: -1,
      hasAdvisoryExitCode: true,
    })
  })

  it('continues to reject a real non-zero status', () => {
    expect(() => parseVerifiedFfprobeResult(1, verifiedMp3)).toThrow(
      'FFprobe 以状态码 1 结束。',
    )
  })

  it('does not accept a -1 sentinel without a verifiable container and audio stream', () => {
    expect(() =>
      parseVerifiedFfprobeResult(-1, JSON.stringify({ format: { format_name: 'mp3' } })),
    ).toThrow('FFprobe 输出未包含可验证的容器与音频流信息。')
  })

  it('rejects malformed output even when ffprobe reported success', () => {
    expect(() => parseVerifiedFfprobeResult(0, '{not JSON}')).toThrow(
      'FFprobe 输出不是可验证的 JSON。',
    )
  })
})
