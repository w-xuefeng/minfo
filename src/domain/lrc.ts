export interface LyricsTimelineEvent {
  readonly line: number
  readonly milliseconds: number
  readonly timeLabel: string
  readonly text: string
}

export interface LyricsPreview {
  readonly mode: 'plain' | 'timed' | 'mixed'
  readonly events: readonly LyricsTimelineEvent[]
  readonly plainLines: readonly string[]
  readonly unmarkedLines: readonly string[]
}

const timestamp = /\[(\d+):(\d{2})(?:\.(\d{2,3}))?\]/gy

const millisecondsFor = (minutes: string, seconds: string, fraction?: string): number => {
  const fractionalMilliseconds = fraction
    ? Number(fraction) * (fraction.length === 2 ? 10 : 1)
    : 0
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + fractionalMilliseconds
}

const formatTimestamp = (milliseconds: number): string => {
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const remainder = milliseconds % 1_000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    remainder,
  ).padStart(3, '0')}`
}

export const parseLyricsPreview = (lyrics: string): LyricsPreview => {
  const lines = lyrics.replace(/\r\n?/g, '\n').split('\n')
  const events: LyricsTimelineEvent[] = []
  const unmarkedLines: string[] = []

  lines.forEach((line, index) => {
    timestamp.lastIndex = 0
    const values: number[] = []
    let matchedLength = 0
    let match: RegExpExecArray | null

    while ((match = timestamp.exec(line))) {
      const [, minutes, seconds, fraction] = match
      if (!minutes || !seconds || Number(seconds) > 59) {
        continue
      }
      values.push(millisecondsFor(minutes, seconds, fraction))
      matchedLength = timestamp.lastIndex
    }

    if (values.length === 0) {
      if (line.trim()) {
        unmarkedLines.push(line)
      }
      return
    }

    const text = line.slice(matchedLength)
    for (const milliseconds of values) {
      events.push({
        line: index,
        milliseconds,
        timeLabel: formatTimestamp(milliseconds),
        text,
      })
    }
  })

  return {
    mode: events.length === 0 ? 'plain' : unmarkedLines.length > 0 ? 'mixed' : 'timed',
    events,
    plainLines: lines,
    unmarkedLines,
  }
}
