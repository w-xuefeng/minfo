<script setup lang="ts">
import { IconPlus, IconRotate, IconX } from '@tabler/icons-vue'

import CoverManager from './CoverManager.vue'
import LyricsSlotManager from './LyricsSlotManager.vue'
import type {
  EditableFormCapabilities,
  EditableMetadataFormField,
} from '@/domain/editable-form-capabilities'
import { joinValues, splitValues, type FieldValidation } from '@/domain/metadata-validation'
import type { CoverArtwork, EditableTag, MetadataDraft, QueueItem } from '@/domain/model'

type ListField = 'artists' | 'albumArtists' | 'genres' | 'composers'

const props = defineProps<{
  item: QueueItem
  errors: readonly FieldValidation[]
  capabilities: EditableFormCapabilities
}>()

const emit = defineEmits<{
  update: [patch: Partial<MetadataDraft>]
  restore: [field: keyof MetadataDraft]
  'add-cover': [cover: CoverArtwork]
  'replace-cover': [coverId: string, cover: CoverArtwork]
  'update-cover': [coverId: string, patch: Partial<CoverArtwork>]
  'remove-cover': [coverId: string]
  'move-cover': [coverId: string, direction: -1 | 1]
}>()

const inputValue = (event: Event): string => (event.target as HTMLInputElement).value
const textareaValue = (event: Event): string => (event.target as HTMLTextAreaElement).value

const changed = (field: keyof MetadataDraft): boolean =>
  JSON.stringify(props.item.draft[field]) !== JSON.stringify(props.item.originalDraft[field])

const errorFor = (field: keyof MetadataDraft): string | undefined =>
  props.errors.find((error) => error.field === field)?.message

const isEditable = (field: EditableMetadataFormField): boolean =>
  props.capabilities[field].editable

const updateText = (field: keyof MetadataDraft, value: string): void => {
  emit('update', { [field]: value } as Partial<MetadataDraft>)
}

const updateValues = (field: ListField, event: Event): void => {
  emit('update', { [field]: splitValues(inputValue(event)) } as Partial<MetadataDraft>)
}

const tagId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tag-${Date.now()}-${Math.random().toString(36).slice(2)}`

const addTag = (): void => {
  emit('update', {
    rawTags: [...props.item.draft.rawTags, { id: tagId(), key: '', value: '' }],
  })
}

const updateTag = (id: string, patch: Partial<EditableTag>): void => {
  emit('update', {
    rawTags: props.item.draft.rawTags.map((tag) =>
      tag.id === id ? { ...tag, ...patch } : tag,
    ),
  })
}

const removeTag = (id: string): void => {
  emit('update', { rawTags: props.item.draft.rawTags.filter((tag) => tag.id !== id) })
}

const restoreTrack = (): void => {
  emit('restore', 'trackNo')
  emit('restore', 'trackTotal')
}

const restoreDisc = (): void => {
  emit('restore', 'discNo')
  emit('restore', 'discTotal')
}
</script>

<template>
  <form class="metadata-editor" novalidate @submit.prevent>
    <section class="panel form-section" aria-labelledby="basic-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">可编辑元数据</p>
          <h2 id="basic-heading">基本信息</h2>
        </div>
        <span class="section-note">清空字段表示请求删除该标签</span>
      </div>

      <div class="form-grid">
        <label class="field field-wide">
          <span class="field-label">标题</span>
          <span class="field-control">
            <input
              :value="props.item.draft.title"
              autocomplete="off"
              :disabled="!isEditable('title')"
              @input="updateText('title', inputValue($event))"
            />
            <button
              v-if="changed('title')"
              type="button"
              class="field-reset"
              aria-label="恢复原标题"
              :disabled="!isEditable('title')"
              @click="emit('restore', 'title')"
            >
              <IconRotate :size="15" aria-hidden="true" />
              恢复
            </button>
          </span>
        </label>

        <label class="field field-wide">
          <span class="field-label">艺术家</span>
          <span class="field-control">
            <input
              :value="joinValues(props.item.draft.artists)"
              autocomplete="off"
              placeholder="多个值用逗号、分号或换行分隔"
              :disabled="!isEditable('artists')"
              @input="updateValues('artists', $event)"
            />
            <button
              v-if="changed('artists')"
              type="button"
              class="field-reset"
              aria-label="恢复原艺术家"
              :disabled="!isEditable('artists')"
              @click="emit('restore', 'artists')"
            >
              <IconRotate :size="15" aria-hidden="true" />
              恢复
            </button>
          </span>
        </label>

        <label class="field">
          <span class="field-label">专辑</span>
          <span class="field-control">
            <input
              :value="props.item.draft.album"
              autocomplete="off"
              :disabled="!isEditable('album')"
              @input="updateText('album', inputValue($event))"
            />
            <button
              v-if="changed('album')"
              type="button"
              class="field-reset"
              :disabled="!isEditable('album')"
              @click="emit('restore', 'album')"
            >
              <IconRotate :size="15" aria-hidden="true" />
              恢复
            </button>
          </span>
        </label>

        <label class="field">
          <span class="field-label">专辑艺术家</span>
          <span class="field-control">
            <input
              :value="joinValues(props.item.draft.albumArtists)"
              autocomplete="off"
              placeholder="多个值用逗号分隔"
              :disabled="!isEditable('albumArtists')"
              @input="updateValues('albumArtists', $event)"
            />
            <button
              v-if="changed('albumArtists')"
              type="button"
              class="field-reset"
              :disabled="!isEditable('albumArtists')"
              @click="emit('restore', 'albumArtists')"
            >
              <IconRotate :size="15" aria-hidden="true" />
              恢复
            </button>
          </span>
        </label>

        <label class="field">
          <span class="field-label">流派</span>
          <span class="field-control">
            <input
              :value="joinValues(props.item.draft.genres)"
              autocomplete="off"
              placeholder="多个值用逗号分隔"
              :disabled="!isEditable('genres')"
              @input="updateValues('genres', $event)"
            />
            <button
              v-if="changed('genres')"
              type="button"
              class="field-reset"
              :disabled="!isEditable('genres')"
              @click="emit('restore', 'genres')"
            >
              <IconRotate :size="15" aria-hidden="true" />
              恢复
            </button>
          </span>
        </label>

        <label class="field">
          <span class="field-label">发行日期</span>
          <span class="field-control">
            <input
              :value="props.item.draft.releaseDate"
              inputmode="numeric"
              placeholder="YYYY、YYYY-MM 或 YYYY-MM-DD"
              :aria-invalid="Boolean(errorFor('releaseDate'))"
              :disabled="!isEditable('releaseDate')"
              @input="updateText('releaseDate', inputValue($event))"
            />
            <button
              v-if="changed('releaseDate')"
              type="button"
              class="field-reset"
              :disabled="!isEditable('releaseDate')"
              @click="emit('restore', 'releaseDate')"
            >
              <IconRotate :size="15" aria-hidden="true" />
              恢复
            </button>
          </span>
          <span v-if="errorFor('releaseDate')" class="field-error">{{
            errorFor('releaseDate')
          }}</span>
        </label>

        <label class="field field-wide">
          <span class="field-label">作曲者</span>
          <span class="field-control">
            <input
              :value="joinValues(props.item.draft.composers)"
              autocomplete="off"
              placeholder="多个值用逗号分隔"
              :disabled="!isEditable('composers')"
              @input="updateValues('composers', $event)"
            />
            <button
              v-if="changed('composers')"
              type="button"
              class="field-reset"
              :disabled="!isEditable('composers')"
              @click="emit('restore', 'composers')"
            >
              <IconRotate :size="15" aria-hidden="true" />
              恢复
            </button>
          </span>
        </label>

        <label class="field field-wide">
          <span class="field-label">评论</span>
          <span class="field-control textarea-control">
            <textarea
              :value="props.item.draft.comment"
              rows="3"
              :disabled="!isEditable('comment')"
              @input="updateText('comment', textareaValue($event))"
            />
            <button
              v-if="changed('comment')"
              type="button"
              class="field-reset"
              :disabled="!isEditable('comment')"
              @click="emit('restore', 'comment')"
            >
              <IconRotate :size="15" aria-hidden="true" />
              恢复
            </button>
          </span>
        </label>
      </div>
    </section>

    <section class="panel form-section" aria-labelledby="track-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">编排信息</p>
          <h2 id="track-heading">曲目与碟片</h2>
        </div>
      </div>
      <div class="number-pairs">
        <div class="number-pair">
          <span class="field-label">曲目</span>
          <label>
            <span class="visually-hidden">曲目编号</span>
            <input
              :value="props.item.draft.trackNo"
              inputmode="numeric"
              placeholder="编号"
              :aria-invalid="Boolean(errorFor('trackNo'))"
              :disabled="!isEditable('track')"
              @input="updateText('trackNo', inputValue($event))"
            />
          </label>
          <span aria-hidden="true">/</span>
          <label>
            <span class="visually-hidden">曲目总数</span>
            <input
              :value="props.item.draft.trackTotal"
              inputmode="numeric"
              placeholder="总数"
              :disabled="!isEditable('track')"
              @input="updateText('trackTotal', inputValue($event))"
            />
          </label>
          <button
            v-if="changed('trackNo') || changed('trackTotal')"
            type="button"
            class="field-reset"
            :disabled="!isEditable('track')"
            @click="restoreTrack"
          >
            <IconRotate :size="15" aria-hidden="true" />
            恢复
          </button>
          <span v-if="errorFor('trackNo')" class="field-error">{{ errorFor('trackNo') }}</span>
        </div>
        <div class="number-pair">
          <span class="field-label">碟片</span>
          <label>
            <span class="visually-hidden">碟片编号</span>
            <input
              :value="props.item.draft.discNo"
              inputmode="numeric"
              placeholder="编号"
              :aria-invalid="Boolean(errorFor('discNo'))"
              :disabled="!isEditable('disc')"
              @input="updateText('discNo', inputValue($event))"
            />
          </label>
          <span aria-hidden="true">/</span>
          <label>
            <span class="visually-hidden">碟片总数</span>
            <input
              :value="props.item.draft.discTotal"
              inputmode="numeric"
              placeholder="总数"
              :disabled="!isEditable('disc')"
              @input="updateText('discTotal', inputValue($event))"
            />
          </label>
          <button
            v-if="changed('discNo') || changed('discTotal')"
            type="button"
            class="field-reset"
            :disabled="!isEditable('disc')"
            @click="restoreDisc"
          >
            <IconRotate :size="15" aria-hidden="true" />
            恢复
          </button>
          <span v-if="errorFor('discNo')" class="field-error">{{ errorFor('discNo') }}</span>
        </div>
      </div>
    </section>

    <section class="panel form-section">
      <LyricsSlotManager
        :slots="props.item.draft.lyricsSlots"
        :original-slots="props.item.originalDraft.lyricsSlots"
        :editable="isEditable('lyrics')"
        :disabled-reason="props.capabilities.lyrics.disabledReason"
        :error="errorFor('lyricsSlots')"
        @update="emit('update', { lyricsSlots: $event })"
      />
    </section>

    <section class="panel form-section" aria-labelledby="cover-heading">
      <CoverManager
        :covers="props.item.draft.covers"
        :editable="isEditable('covers')"
        :disabled-reason="props.capabilities.covers.disabledReason"
        @add="emit('add-cover', $event)"
        @replace="(coverId, cover) => emit('replace-cover', coverId, cover)"
        @update="(coverId, patch) => emit('update-cover', coverId, patch)"
        @remove="emit('remove-cover', $event)"
        @move="(coverId, direction) => emit('move-cover', coverId, direction)"
      />
    </section>

    <details class="panel advanced-tags">
      <summary>
        <span>
          <span class="eyebrow">高级</span>
          <strong>原始文本标签</strong>
        </span>
        <span>{{ props.item.draft.rawTags.length }} 项</span>
      </summary>
      <p class="inline-note">
        此区仅用于文本标签。标准字段与等价原始标签同时修改时，导出前应先核对最终映射。
      </p>
      <div class="raw-tag-list">
        <div v-for="tag in props.item.draft.rawTags" :key="tag.id" class="raw-tag-row">
          <label>
            <span class="visually-hidden">标签键</span>
            <input
              :value="tag.key"
              placeholder="键"
              :disabled="!isEditable('rawTags')"
              @input="updateTag(tag.id, { key: inputValue($event) })"
            />
          </label>
          <label>
            <span class="visually-hidden">标签值</span>
            <input
              :value="tag.value"
              placeholder="值"
              :disabled="!isEditable('rawTags')"
              @input="updateTag(tag.id, { value: inputValue($event) })"
            />
          </label>
          <button
            type="button"
            class="icon-button danger"
            :aria-label="`删除标签 ${tag.key || '新建标签'}`"
            :disabled="!isEditable('rawTags')"
            @click="removeTag(tag.id)"
          >
            <IconX :size="17" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p v-if="errorFor('rawTags')" class="field-error">{{ errorFor('rawTags') }}</p>
      <button
        type="button"
        class="button button-secondary button-small"
        :disabled="!isEditable('rawTags')"
        @click="addTag"
      >
        <IconPlus :size="17" aria-hidden="true" />
        添加原始标签
      </button>
    </details>
  </form>
</template>
