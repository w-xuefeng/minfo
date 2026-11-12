import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CreateSelect from './CreateSelect.vue'

const options = [
  { value: 'und', label: '未指定' },
  { value: 'zho', label: '中文' },
  { value: 'eng', label: '英文', disabled: true },
]

describe('CreateSelect', () => {
  it('selects an enabled option and does not select a disabled option', async () => {
    const wrapper = mount(CreateSelect, {
      props: { modelValue: '', options },
    })

    await wrapper.get('.create-select-input').trigger('focus')
    const disabledOption = wrapper
      .findAll('.create-select-option')
      .find((option) => option.text() === '英文')
    expect(disabledOption?.attributes('disabled')).toBeDefined()

    const optionButtons = wrapper.findAll('.create-select-option')
    await optionButtons[1]!.trigger('click')

    expect(wrapper.emitted<'update:modelValue'>('update:modelValue')?.[0]).toEqual(['zho'])
    expect(wrapper.emitted('select')?.[0]).toEqual(['zho'])
  })

  it('filters disabled options when requested', async () => {
    const wrapper = mount(CreateSelect, {
      props: { modelValue: '', options, filterDisabled: true },
    })

    await wrapper.get('.create-select-input').trigger('focus')

    expect(wrapper.text()).toContain('中文')
    expect(wrapper.text()).not.toContain('英文')
  })

  it('shows all options when the displayed value is the current selection', async () => {
    const wrapper = mount(CreateSelect, {
      props: { modelValue: 'zho', options },
    })

    const input = wrapper.get<HTMLInputElement>('.create-select-input')
    await input.trigger('focus')
    expect(wrapper.findAll('.create-select-option')).toHaveLength(3)

    await input.setValue('未')
    expect(wrapper.findAll('.create-select-option').map((option) => option.text())).toEqual([
      '未指定',
    ])
  })

  it('creates a distinct value through input and Enter', async () => {
    const wrapper = mount(CreateSelect, {
      props: { modelValue: '', options, allowCreate: true },
    })

    const input = wrapper.get<HTMLInputElement>('.create-select-input')
    await input.setValue('fra')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted<'update:modelValue'>('update:modelValue')?.at(-1)).toEqual(['fra'])
    expect(wrapper.emitted('create')?.[0]).toEqual(['fra'])
  })

  it('supports arrow-key navigation and selection', async () => {
    const wrapper = mount(CreateSelect, {
      props: { modelValue: '', options },
    })
    const input = wrapper.get('.create-select-input')

    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('select')?.[0]).toEqual(['zho'])
  })

  it('confirms an exact typed option with Enter even before arrow navigation', async () => {
    const wrapper = mount(CreateSelect, {
      props: { modelValue: '', options },
    })
    const input = wrapper.get<HTMLInputElement>('.create-select-input')

    await input.setValue('zho')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('select')?.[0]).toEqual(['zho'])
  })

  it('keeps option buttons keyboard-activatable', async () => {
    const wrapper = mount(CreateSelect, {
      props: { modelValue: '', options },
    })

    await wrapper.get('.create-select-input').trigger('focus')
    await wrapper.findAll('.create-select-option')[0]!.trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['und'])
  })
})
