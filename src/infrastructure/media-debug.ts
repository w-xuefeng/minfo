export type MediaTool = 'ffmpeg' | 'ffprobe'

const enabledValues = new Set(['1', 'true', 'yes', 'on'])
const muxingQueueDelayPattern =
  /^Delay between the first packet and last packet in the muxing queue is \d+ > \d+: forcing output\.?$/

export const isMediaDebugEnabled = (development: boolean, value: string | undefined): boolean =>
  development && enabledValues.has(value?.trim().toLowerCase() ?? '')

/**
 * An attached-picture stream has one packet while an audio stream can run for
 * minutes. FFmpeg forces interleaving after its bounded queue delay, emitting
 * this same informational line for many audio packets.
 */
export const isExpectedMuxingQueueDelay = (
  tool: MediaTool,
  stream: string,
  message: string,
): boolean =>
  tool === 'ffmpeg' && stream === 'stdout' && muxingQueueDelayPattern.test(message.trim())

/**
 * Vite exposes only `VITE_*` variables to browser code. Keep the DEV check
 * here as a second boundary so a production build never writes media logs to
 * the browser console, even if the variable was present at build time.
 */
export const mediaDebugEnabled = isMediaDebugEnabled(
  import.meta.env.DEV,
  import.meta.env.VITE_MINFO_MEDIA_DEBUG,
)

/**
 * The direct DEV branch lets Vite remove console-debug code from production
 * bundles entirely. `mediaDebugEnabled` still controls the explicit opt-in
 * inside a development build.
 */
export const debugMediaLog: (tool: MediaTool, stream: string, message: string) => void =
  import.meta.env.DEV
    ? (tool, stream, message) => {
        if (!mediaDebugEnabled) return
        console.debug(`[MINFO media:${tool}:${stream}] ${message}`)
      }
    : () => undefined
