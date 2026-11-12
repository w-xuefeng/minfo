import { mount } from '@vue/test-utils'
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
})
