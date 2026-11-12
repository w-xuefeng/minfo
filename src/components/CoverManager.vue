<script setup lang="ts">
import { ref } from 'vue'
import {
  IconArrowsSort,
  IconChevronDown,
  IconChevronUp,
  IconPhotoPlus,
  IconPhotoX,
  IconReplace,
} from '@tabler/icons-vue'

import { validateCover } from '@/domain/cover'
import type { CoverArtwork, CoverKind } from '@/domain/model'

const props = defineProps<{
  covers: readonly CoverArtwork[]
  editable: boolean
  disabledReason: string | undefined
}>()

const emit = defineEmits<{
  add: [cover: CoverArtwork]
  replace: [coverId: string, cover: CoverArtwork]
  update: [coverId: string, patch: Partial<CoverArtwork>]
  remove: [coverId: string]
  move: [coverId: string, direction: -1 | 1]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const error = ref('')
const action = ref<{ readonly kind: 'add' | 'replace'; readonly coverId?: string }>({
  kind: 'add',
})

const pick = (kind: 'add' | 'replace', coverId?: string): void => {
  if (!props.editable) return
  action.value = { kind, ...(coverId ? { coverId } : {}) }
  error.value = ''
  fileInput.value?.click()
}

const onSelect = async (event: Event): Promise<void> => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!props.editable) return
  if (!file) return
  const validation = await validateCover(file)
  if (!validation.ok || !validation.cover) {
    error.value = validation.error ?? '封面校验失败。'
    return
  }
  if (action.value.kind === 'replace' && action.value.coverId) {
    emit('replace', action.value.coverId, validation.cover)
  } else {
    emit('add', validation.cover)
  }
}

const setKind = (coverId: string, event: Event): void => {
  if (!props.editable) return
  const target = event.target as HTMLSelectElement
  emit('update', coverId, { kind: target.value as CoverKind })
}

const move = (coverId: string, direction: -1 | 1): void => {
  if (props.editable) emit('move', coverId, direction)
}

const remove = (coverId: string): void => {
  if (props.editable) emit('remove', coverId)
}

const dimensions = (cover: CoverArtwork): string =>
  cover.width && cover.height ? `${cover.width}×${cover.height} px` : '嵌入图片'
</script>

<template>
  <section
    class="cover-manager"
    :class="{ 'is-readonly': !props.editable }"
    aria-labelledby="cover-heading"
    :aria-describedby="props.editable ? undefined : 'cover-editability-help'"
  >
    <div class="subsection-heading">
      <div>
        <p class="eyebrow">图片管理</p>
        <h3 id="cover-heading">封面</h3>
      </div>
      <button
        type="button"
        class="button button-secondary button-small"
        :disabled="!props.editable"
        @click="pick('add')"
      >
        <IconPhotoPlus :size="17" aria-hidden="true" />
        添加封面
      </button>
    </div>
    <p class="inline-note">
      新选图片仅接受 PNG、JPG/JPEG、GIF、WebP，最大 2 MB，宽高均不超过 1000 px。
    </p>
    <p v-if="!props.editable" id="cover-editability-help" class="field-help">
      {{ props.disabledReason ?? '当前输出格式不支持编辑封面。' }}
    </p>

    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      :disabled="!props.editable"
      @change="onSelect"
    />
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>

    <p v-if="props.covers.length === 0" class="cover-empty">
      尚无嵌入封面。添加的图片会先在浏览器中验证。
    </p>
    <ol v-else class="cover-list">
      <li v-for="(cover, index) in props.covers" :key="cover.id" class="cover-card">
        <div class="cover-preview">
          <img
            v-if="cover.previewUrl"
            :src="cover.previewUrl"
            :alt="`${cover.kind} 封面预览`"
          />
          <span v-else aria-hidden="true"><IconArrowsSort :size="20" /></span>
        </div>
        <div class="cover-details">
          <div class="cover-title-row">
            <strong>图片 {{ index + 1 }}</strong>
            <span class="status-label">{{
              cover.source === 'embedded' ? '原有' : '新选'
            }}</span>
          </div>
          <p>{{ cover.mime }} · {{ dimensions(cover) }}</p>
          <label>
            <span class="visually-hidden">图片 {{ index + 1 }} 的类型</span>
            <select
              :value="cover.kind"
              :disabled="!props.editable"
              @change="setKind(cover.id, $event)"
            >
              <option value="front">正面封面</option>
              <option value="back">背面封面</option>
              <option value="disc">唱片</option>
              <option value="artist">艺术家</option>
              <option value="other">其他</option>
            </select>
          </label>
        </div>
        <div class="cover-actions" aria-label="封面操作">
          <button
            type="button"
            class="icon-button"
            :disabled="!props.editable || index === 0"
            :aria-label="`上移图片 ${index + 1}`"
            @click="move(cover.id, -1)"
          >
            <IconChevronUp :size="18" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-button"
            :disabled="!props.editable || index === props.covers.length - 1"
            :aria-label="`下移图片 ${index + 1}`"
            @click="move(cover.id, 1)"
          >
            <IconChevronDown :size="18" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-button"
            :aria-label="`替换图片 ${index + 1}`"
            :disabled="!props.editable"
            @click="pick('replace', cover.id)"
          >
            <IconReplace :size="18" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-button danger"
            :aria-label="`移除图片 ${index + 1}`"
            :disabled="!props.editable"
            @click="remove(cover.id)"
          >
            <IconPhotoX :size="18" aria-hidden="true" />
          </button>
        </div>
      </li>
    </ol>
  </section>
</template>
