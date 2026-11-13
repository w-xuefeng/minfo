import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ExportPanel from './ExportPanel.vue'
import { emptyDraft } from '@/domain/model'
import type { ExportPlan, ExportRequest, QueueItem, RuntimeStatus } from '@/domain/model'

const runtime: RuntimeStatus = {
  state: 'ready',
  version: 'test-runtime',
  message: 'ready',
}

const request: ExportRequest = {
  format: 'original',
  quality: 'high',
  outputBaseName: 'output',
  allowOverwrite: false,
}

const item: QueueItem = {
  id: 'item-1',
  file: new File(['audio'], 'source.mp3', { type: 'audio/mpeg', lastModified: 1 }),
  identity: { name: 'source.mp3', size: 5, lastModified: 1 },
  status: 'ready',
  draft: emptyDraft(),
  originalDraft: emptyDraft(),
  technical: {
    extension: 'mp3',
    mime: 'audio/mpeg',
    container: 'MPEG',
    codec: 'MP3',
    tagTypes: ['ID3v2.4'],
  },
  nativeTags: [],
  warnings: [],
  readNotices: [],
  draftRevision: 1,
  createdAt: 1,
}

const plan: ExportPlan = {
  sourceIdentity: item.identity,
  draftRevision: item.draftRevision,
  format: 'original',
  requestedExtension: 'mp3',
  resolvedFormat: 'mp3',
  outputFileName: 'output.mp3',
  quality: 'high',
  requiresTranscode: false,
  engine: 'browser-runtime',
  runnable: true,
  summary: 'MP3: 将以流复制方式写入元信息，不重新编码音频。',
  risks: [],
  runtimeVersion: runtime.version,
}

describe('ExportPanel', () => {
  it('enables a lossy new-copy export only after the user explicitly acknowledges it', async () => {
    const acknowledgementPlan: ExportPlan = {
      ...plan,
      summary: 'AAC: 检测到 1 项副本影响；勾选“我已知晓，坚持导出”后可继续。',
      risks: [
        {
          id: 'cover-omitted',
          kind: 'cover-capacity',
          title: 'AAC 副本不会包含内嵌封面',
          description: '确认后会生成不含封面的 AAC 新副本；源文件不变。',
          requiresConfirmation: true,
        },
      ],
    }
    const wrapper = mount(ExportPanel, {
      props: {
        item,
        request,
        plan: acknowledgementPlan,
        runtime,
        errors: [],
        progress: null,
        exportError: '',
      },
    })

    const button = wrapper.get('.button-primary')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('我已知晓，坚持导出')
    expect(wrapper.text()).toContain('源文件不会被修改')

    await wrapper.get('.confirmation-panel input').setValue(true)

    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    expect(wrapper.emitted('export')).toEqual([[acknowledgementPlan]])
  })

  it('does not ask for a local replacement-cover path when the selected AAC copy omits covers', () => {
    const aacPlan: ExportPlan = {
      ...plan,
      format: 'aac',
      requestedExtension: 'aac',
      resolvedFormat: 'aac',
      outputFileName: 'output.aac',
      requiresTranscode: true,
      risks: [
        {
          id: 'cover-omitted',
          kind: 'cover-capacity',
          title: 'AAC 副本不会包含内嵌封面',
          description: '确认后生成不含封面的新副本。',
          requiresConfirmation: true,
        },
      ],
    }
    const itemWithReplacement = {
      ...item,
      draft: {
        ...item.draft,
        covers: [
          {
            id: 'replacement',
            kind: 'front' as const,
            mime: 'image/jpeg',
            size: 1,
            source: 'replacement' as const,
          },
        ],
      },
    }
    const wrapper = mount(ExportPanel, {
      props: {
        item: itemWithReplacement,
        request: { ...request, format: 'aac' },
        plan: aacPlan,
        runtime,
        errors: [],
        progress: null,
        exportError: '',
      },
    })

    expect(wrapper.text()).toContain('当前目标会省略的封面不会要求路径')
    expect(wrapper.text()).not.toContain('替换封面 1 的本地路径')
  })

  it('recommends MP3 for every configured cover-omission risk, not only AAC', async () => {
    const m4aPlan: ExportPlan = {
      ...plan,
      format: 'm4a',
      requestedExtension: 'm4a',
      resolvedFormat: 'm4a',
      outputFileName: 'output.m4a',
      requiresTranscode: true,
      risks: [
        {
          id: 'cover-omitted',
          kind: 'cover-capacity',
          title: '部分封面将从新副本省略',
          description: 'M4A 将省略 GIF 封面。',
          requiresConfirmation: true,
        },
      ],
    }
    const wrapper = mount(ExportPanel, {
      props: {
        item,
        request: { ...request, format: 'm4a' },
        plan: m4aPlan,
        runtime,
        errors: [],
        progress: null,
        exportError: '',
      },
    })

    expect(wrapper.text()).toContain('推荐兼容格式：MP3')
    await wrapper.get('.format-fallback button').trigger('click')
    expect(wrapper.emitted('update-request')).toEqual([[{ ...request, format: 'mp3' }]])
  })

  it('keeps an asynchronous export error next to the action and focuses it', async () => {
    const scrollIntoView = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    try {
      const wrapper = mount(ExportPanel, {
        attachTo: document.body,
        props: {
          item,
          request,
          plan,
          runtime,
          errors: [],
          progress: null,
          exportError: '',
        },
      })

      await wrapper.setProps({
        exportError: '导出后的普通歌词未通过 FFprobe 回读验证，已取消下载。',
      })
      await wrapper.vm.$nextTick()

      const outcome = wrapper.get('.export-outcome')
      expect(outcome.text()).toContain('导出未完成')
      expect(outcome.text()).toContain('未下载任何输出文件')
      expect(outcome.attributes('role')).toBe('alert')
      expect(document.activeElement).toBe(outcome.element)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
      wrapper.unmount()
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: original,
        })
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
      }
    }
  })
})
