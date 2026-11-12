import { describe, expect, it } from 'vitest'

import { emptyDraft } from '@/domain/model'

import {
  findRawTagConflicts,
  rawTagEditSafetyIssue,
  resolveRawTagConflict,
  standardFieldRawTagSafetyIssue,
} from './metadata-diff'

describe('raw tag conflict resolution', () => {
  it('finds a conflicting mapped raw tag only when both sides were edited', () => {
    const original = {
      ...emptyDraft(),
      title: 'Original title',
      rawTags: [{ id: 'title', key: 'TIT2', value: 'Original title' }],
    }
    const draft = {
      ...original,
      title: 'Form title',
      rawTags: [{ id: 'title', key: 'TIT2', value: 'Raw title' }],
    }

    expect(findRawTagConflicts(draft, original)).toMatchObject([
      {
        tagId: 'title',
        tagKey: 'TIT2',
        field: 'title',
        standardValue: 'Form title',
        rawValue: 'Raw title',
      },
    ])
  })

  it('synchronizes the chosen value rather than silently dropping either edit', () => {
    const original = {
      ...emptyDraft(),
      title: 'Original title',
      rawTags: [{ id: 'title', key: 'TIT2', value: 'Original title' }],
    }
    const draft = {
      ...original,
      title: 'Form title',
      rawTags: [{ id: 'title', key: 'TIT2', value: 'Raw title' }],
    }
    const [conflict] = findRawTagConflicts(draft, original)
    if (!conflict) throw new Error('Expected conflict')

    expect(resolveRawTagConflict(draft, conflict, 'standard')).toEqual({
      rawTags: [{ id: 'title', key: 'TIT2', value: 'Form title' }],
    })
    expect(resolveRawTagConflict(draft, conflict, 'raw')).toEqual({ title: 'Raw title' })
  })

  it('blocks a change, deletion, or addition that targets a duplicate raw key', () => {
    const original = {
      ...emptyDraft(),
      rawTags: [
        { id: 'one', key: 'TXXX', value: 'first' },
        { id: 'two', key: 'TXXX', value: 'second' },
      ],
    }

    expect(
      rawTagEditSafetyIssue(
        {
          ...original,
          rawTags: [{ ...original.rawTags[0]!, value: 'changed' }, original.rawTags[1]!],
        }.rawTags,
        original.rawTags,
      ),
    ).toContain('TXXX')
    expect(rawTagEditSafetyIssue([original.rawTags[0]!], original.rawTags)).toContain('TXXX')
    expect(
      rawTagEditSafetyIssue(
        [...original.rawTags, { id: 'three', key: 'TXXX', value: 'third' }],
        original.rawTags,
      ),
    ).toContain('TXXX')
  })

  it('blocks a standard-field edit that would overwrite duplicate mapped raw tags', () => {
    const original = {
      ...emptyDraft(),
      title: 'old',
      rawTags: [
        { id: 'one', key: 'TIT2', value: 'old' },
        { id: 'two', key: 'TIT2', value: 'alternate title' },
      ],
    }

    expect(standardFieldRawTagSafetyIssue({ ...original, title: 'new' }, original)).toContain(
      '标题',
    )
  })
})
