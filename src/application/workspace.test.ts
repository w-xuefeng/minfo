import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWorkspace, transientNoticeDismissAfterMs } from './workspace'

describe('workspace notices', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('automatically closes a short-lived confirmation after its configured duration', () => {
    vi.useFakeTimers()
    const workspace = createWorkspace()
    const file = new File(['audio'], 'track.mp3', { type: 'audio/mpeg' })

    workspace.addFiles([file])

    expect(workspace.notice.value).toMatchObject({
      kind: 'info',
      message: '已加入 1 个音频文件，正按顺序读取。',
      dismissAfterMs: transientNoticeDismissAfterMs,
    })
    vi.advanceTimersByTime(transientNoticeDismissAfterMs - 1)
    expect(workspace.notice.value).not.toBeNull()

    vi.advanceTimersByTime(1)
    expect(workspace.notice.value).toBeNull()
    workspace.dispose()
  })

  it('keeps an error notice visible when it replaces a transient confirmation', () => {
    vi.useFakeTimers()
    const workspace = createWorkspace()
    const audio = new File(['audio'], 'track.mp3', { type: 'audio/mpeg' })
    const unsupported = new File(['text'], 'notes.txt', { type: 'text/plain' })

    workspace.addFiles([audio, unsupported])

    expect(workspace.notice.value).toMatchObject({
      kind: 'error',
      message: '1 个文件不是可识别的音频文件，未加入队列。',
    })
    vi.advanceTimersByTime(transientNoticeDismissAfterMs)
    expect(workspace.notice.value?.kind).toBe('error')
    workspace.dispose()
  })
})
