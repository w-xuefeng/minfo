import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LyricsSlotManager from './LyricsSlotManager.vue'
import type { LyricsSlot } from '@/domain/model'

const slot = (language: string, text = ''): LyricsSlot => ({
  id: language,
  language,
  descriptor: '',
  representation: 'plain',
  text,
})

const lyricFile = (contents: string, name: string): File =>
  new File([contents], name, { type: 'text/plain' })

const chooseLyricsFile = async (
  wrapper: ReturnType<typeof mount>,
  language: string,
  file: File,
): Promise<void> => {
  await wrapper.get(`button[aria-label="为 ${language} 歌词槽位解析歌词文件"]`).trigger('click')
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change')
  await flushPromises()
}

describe('LyricsSlotManager', () => {
  it('adds a distinct language slot through the creatable language input', async () => {
    const wrapper = mount(LyricsSlotManager, {
      props: {
        slots: [slot('eng', 'English')],
        originalSlots: [slot('eng', 'English')],
        editable: true,
      },
    })

    expect(wrapper.find('details').attributes('open')).toBeUndefined()
    expect(wrapper.find('.lyrics-slot-add .create-select').exists()).toBe(true)
    await wrapper.find('.lyrics-slot-add .create-select-input').setValue('zho')
    await wrapper.get('.lyrics-slot-add > .button').trigger('click')

    const updates = wrapper.emitted<readonly [readonly LyricsSlot[]]>('update')
    expect(updates?.[0]?.[0].map((item) => item.language)).toEqual(['eng', 'zho'])
  })

  it('accepts a user-created language code rather than limiting the input to suggestions', async () => {
    const wrapper = mount(LyricsSlotManager, {
      props: {
        slots: [slot('eng', 'English')],
        originalSlots: [slot('eng', 'English')],
        editable: true,
      },
    })

    await wrapper.find('.lyrics-slot-add .create-select-input').setValue('fra')
    await wrapper.get('.lyrics-slot-add > .button').trigger('click')

    expect(wrapper.emitted<readonly [readonly LyricsSlot[]]>('update')?.[0]?.[0]).toEqual([
      slot('eng', 'English'),
      expect.objectContaining({ language: 'fra', text: '' }),
    ])
  })

  it('does not allow an existing language to be added or assigned to another slot', async () => {
    const slots = [slot('eng', 'English'), slot('zho', '中文')]
    const wrapper = mount(LyricsSlotManager, {
      props: { slots, originalSlots: slots, editable: true },
    })

    await wrapper.find('.lyrics-slot-add .create-select-input').setValue('eng')
    await wrapper.get('.lyrics-slot-add > .button').trigger('click')
    const updateCountAfterDuplicateAdd = wrapper.emitted('update')?.length ?? 0
    expect(updateCountAfterDuplicateAdd).toBe(0)
    expect(wrapper.text()).toContain('每种语言只能保留一个槽位')

    const languageInputs = wrapper.findAll('.lyrics-language-field .create-select-input')
    await languageInputs[0]!.setValue('zho')
    const disabledLanguage = wrapper
      .findAll('.lyrics-language-field .create-select-option')
      .find((option) => option.text() === '中文 (zho)')
    expect(disabledLanguage?.attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('update')?.length ?? 0).toBe(updateCountAfterDuplicateAdd)
  })

  it('emits an independent deletion and disables every writing control when unavailable', async () => {
    const slots = [slot('eng', 'English'), slot('zho', '中文')]
    const editable = mount(LyricsSlotManager, {
      props: { slots, originalSlots: slots, editable: true },
    })
    await editable.get('[aria-label="删除 zho 歌词槽位"]').trigger('click')
    expect(editable.emitted<readonly [readonly LyricsSlot[]]>('update')?.[0]?.[0]).toEqual([
      slot('eng', 'English'),
    ])

    const readonly = mount(LyricsSlotManager, {
      props: {
        slots,
        originalSlots: slots,
        editable: false,
        disabledReason: '当前目标不支持歌词。',
      },
    })
    expect(readonly.text()).toContain('当前目标不支持歌词。')
    expect(
      readonly.find('.lyrics-slot-add .create-select-input').attributes('disabled'),
    ).toBeDefined()
    expect(readonly.find('.lyrics-slot-add button').attributes('disabled')).toBeDefined()
    expect(
      readonly.get('[aria-label="删除 eng 歌词槽位"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      readonly.get('button[aria-label="为 eng 歌词槽位解析歌词文件"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('edits one slot without changing another language slot', async () => {
    const slots = [slot('eng', 'English'), slot('zho', '中文')]
    const wrapper = mount(LyricsSlotManager, {
      props: { slots, originalSlots: slots, editable: true },
    })

    await wrapper.findAll('textarea')[1]!.setValue('更新后的中文歌词')

    expect(wrapper.emitted<readonly [readonly LyricsSlot[]]>('update')?.[0]?.[0]).toEqual([
      slot('eng', 'English'),
      slot('zho', '更新后的中文歌词'),
    ])
  })

  it('keeps each language editor and its collapsible preview in one large slot panel', () => {
    const slots = [slot('eng', 'English'), slot('zho', '[00:01.00]中文')]
    const wrapper = mount(LyricsSlotManager, {
      props: { slots, originalSlots: slots, editable: true },
    })

    const panels = wrapper.findAll('.lyrics-slot-card')
    expect(panels).toHaveLength(2)
    expect(panels[0]!.find('.lyrics-language-field .create-select').exists()).toBe(true)
    expect(panels[0]!.find('textarea').exists()).toBe(true)
    expect(panels[0]!.find('details.lyrics-preview').exists()).toBe(true)
    expect(panels[1]!.text()).toContain('检测到 LRC 时间标签')
  })

  it('filters languages already used by other slots from the add control', async () => {
    const slots = [slot('eng', 'English'), slot('zho', '中文')]
    const wrapper = mount(LyricsSlotManager, {
      props: { slots, originalSlots: slots, editable: true },
    })

    await wrapper.find('.lyrics-slot-add .create-select-input').trigger('focus')

    const options = wrapper
      .find('.lyrics-slot-add')
      .findAll('.create-select-option')
      .map((option) => option.text())
    expect(options.slice(0, 4)).toEqual([
      '未指定 (und)',
      '日语 (jpn)',
      '韩语 (kor)',
      '法语 (fra)',
    ])
    expect(options).toContain('菲律宾语 (fil)')
    expect(options).not.toContain('英语 (eng)')
    expect(options).not.toContain('中文 (zho)')
  })

  it('imports a selected LRC file directly into an empty language slot', async () => {
    const slots = [slot('eng')]
    const wrapper = mount(LyricsSlotManager, {
      props: { slots, originalSlots: slots, editable: true },
    })

    await chooseLyricsFile(wrapper, 'eng', lyricFile('[00:01.00]Imported lyric', 'song.lrc'))

    expect(wrapper.emitted<readonly [readonly LyricsSlot[]]>('update')?.[0]?.[0]).toEqual([
      expect.objectContaining({
        id: 'eng',
        text: '[00:01.00]Imported lyric',
        representation: 'synchronised',
      }),
    ])
    expect(wrapper.text()).toContain('已解析 LRC 歌词文件。')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('asks before replacing existing lyrics and leaves the slot unchanged when cancelled', async () => {
    const slots = [slot('eng', 'Current lyric')]
    const wrapper = mount(LyricsSlotManager, {
      props: { slots, originalSlots: slots, editable: true },
    })
    const file = lyricFile('[00:02.00]Replacement lyric', 'replacement.lrc')

    await chooseLyricsFile(wrapper, 'eng', file)

    expect(wrapper.get('[role="dialog"]').text()).toContain('替换当前歌词？')
    expect(wrapper.get('[role="dialog"]').text()).toContain('replacement.lrc')
    expect(wrapper.emitted('update')).toBeUndefined()

    await wrapper.get('.lyrics-import-dialog-actions .button-secondary').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已取消替换，当前歌词未变。')
    expect(wrapper.emitted('update')).toBeUndefined()

    await chooseLyricsFile(wrapper, 'eng', file)
    await wrapper.get('.lyrics-import-dialog-actions .button-primary').trigger('click')
    expect(wrapper.emitted<readonly [readonly LyricsSlot[]]>('update')?.[0]?.[0]).toEqual([
      expect.objectContaining({
        id: 'eng',
        text: '[00:02.00]Replacement lyric',
        representation: 'synchronised',
      }),
    ])
  })

  it('keeps current lyrics and explains why an unsupported file could not be parsed', async () => {
    const slots = [slot('eng', 'Current lyric')]
    const wrapper = mount(LyricsSlotManager, {
      props: { slots, originalSlots: slots, editable: true },
    })

    await chooseLyricsFile(wrapper, 'eng', lyricFile('subtitle', 'song.srt'))

    expect(wrapper.text()).toContain('仅支持 .txt、.lrc 或 .qrc 歌词文件。')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.emitted('update')).toBeUndefined()
  })
})
