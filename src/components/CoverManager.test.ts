import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CoverManager from './CoverManager.vue'
import type { CoverArtwork } from '@/domain/model'

const embeddedCover: CoverArtwork = {
  id: 'cover-1',
  kind: 'front',
  mime: 'image/jpeg',
  size: 1024,
  source: 'embedded',
}

describe('CoverManager', () => {
  it('keeps existing covers visible while disabling every write control', async () => {
    const wrapper = mount(CoverManager, {
      props: {
        covers: [embeddedCover],
        editable: false,
        disabledReason: 'ADTS AAC 不承载内嵌封面。',
      },
    })

    expect(wrapper.text()).toContain('图片 1')
    expect(wrapper.text()).toContain('ADTS AAC 不承载内嵌封面。')
    expect(wrapper.find('input[type="file"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('select').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button')).toHaveLength(5)
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)

    await wrapper.findAll('button')[0]?.trigger('click')
    expect(wrapper.emitted('add')).toBeUndefined()
  })
})
