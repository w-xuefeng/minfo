export interface FfprobeStream {
  readonly codec_type?: string
  readonly codec_name?: string
  readonly disposition?: { readonly attached_pic?: number }
}

export interface FfprobeDocument {
  readonly format?: {
    readonly format_name?: string
    readonly tags?: Readonly<Record<string, string>>
  }
  readonly streams?: readonly FfprobeStream[]
}

export interface VerifiedFfprobeResult {
  readonly document: FfprobeDocument
  readonly container: string
  readonly audioCodec: string
  readonly exitCode: number
  /** True when the WASM wrapper returned its known `-1` sentinel despite verified JSON. */
  readonly hasAdvisoryExitCode: boolean
}

const toBytes = (value: Uint8Array | string): Uint8Array =>
  typeof value === 'string' ? new TextEncoder().encode(value) : value

export const parseFfprobeDocument = (value: Uint8Array | string): FfprobeDocument => {
  try {
    const text = new TextDecoder().decode(toBytes(value))
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    return parsed as FfprobeDocument
  } catch {
    throw new Error('FFprobe 输出不是可验证的 JSON。')
  }
}

export const streamsOf = (document: FfprobeDocument): readonly FfprobeStream[] =>
  Array.isArray(document.streams) ? document.streams : []

export const primaryAudioCodec = (document: FfprobeDocument): string | undefined => {
  const codec = streamsOf(document).find((stream) => stream.codec_type === 'audio')?.codec_name
  return typeof codec === 'string' && codec.trim() ? codec.trim() : undefined
}

/**
 * Validates the result file instead of trusting the WASM bridge return code.
 *
 * `@ffmpeg/core@0.12.10` can leave `Module.ret` at its default `-1` after a
 * successful `ffprobe()` run. That `-1` sentinel is therefore advisory only;
 * it is accepted solely when the generated JSON proves both a container and
 * an audio stream. Empty, malformed, or incomplete output remains a failure.
 */
export const parseVerifiedFfprobeResult = (
  exitCode: number,
  value: Uint8Array | string,
): VerifiedFfprobeResult => {
  const hasAdvisoryExitCode = exitCode === -1
  if (exitCode !== 0 && !hasAdvisoryExitCode) {
    throw new Error(`FFprobe 以状态码 ${exitCode} 结束。`)
  }

  const document = parseFfprobeDocument(value)
  const container =
    typeof document.format?.format_name === 'string' ? document.format.format_name.trim() : ''
  const audioCodec = primaryAudioCodec(document)
  if (!container || !audioCodec) {
    throw new Error('FFprobe 输出未包含可验证的容器与音频流信息。')
  }

  return {
    document,
    container,
    audioCodec,
    exitCode,
    hasAdvisoryExitCode,
  }
}
