<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconPlus, IconRotate, IconX } from '@tabler/icons-vue'

import CreateSelect, { type CreateSelectOption } from './CreateSelect.vue'
import LyricsPreview from './LyricsPreview.vue'
import {
  duplicateLyricsLanguages,
  isLyricsLanguage,
  lyricsLanguageValidationMessage,
  normalizeLyricsLanguage,
  suggestedLyricsLanguageLabel,
  suggestedLyricsLanguages,
} from '@/domain/lyrics'
import type { LyricsSlot } from '@/domain/model'

const props = defineProps<{
  slots: readonly LyricsSlot[]
  originalSlots: readonly LyricsSlot[]
  editable: boolean
  disabledReason?: string | undefined
  error?: string | undefined
}>()

const emit = defineEmits<{
  update: [slots: readonly LyricsSlot[]]
}>()

const newLanguage = ref<string>(
  suggestedLyricsLanguages.find(
    (language) => !props.slots.some((slot) => slot.language === language),
  ) ?? '',
)
const interactionError = ref('')

const suggestedLanguageSet = new Set<string>(suggestedLyricsLanguages)

const languageOptions = computed<readonly string[]>(() => [
  ...suggestedLyricsLanguages,
  ...[...new Set(props.slots.map((slot) => slot.language))]
    .filter((language) => !suggestedLanguageSet.has(language))
    .sort(),
])

const textareaValue = (event: Event): string => (event.target as HTMLTextAreaElement).value

const languageLabel = (language: string): string => {
  const label = suggestedLyricsLanguageLabel(language)
  return label ? `${label} (${language})` : language
}

const languageOptionsFor = (slot?: LyricsSlot): readonly CreateSelectOption[] =>
  languageOptions.value.map((language) => ({
    value: language,
    label: languageLabel(language),
    disabled: props.slots.some(
      (candidate) => candidate.id !== slot?.id && candidate.language === language,
    ),
  }))

const slotId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `lyrics-${Date.now()}-${Math.random().toString(36).slice(2)}`

const firstSuggestedLanguageNotInUse = (): string =>
  suggestedLyricsLanguages.find(
    (language) => !props.slots.some((slot) => slot.language === language),
  ) ?? ''

const setInteractionError = (message = ''): void => {
  interactionError.value = message
}

const updateNewLanguage = (value: string): void => {
  newLanguage.value = value
  setInteractionError()
}

const validateAvailableLanguage = (value: string, excludingId?: string): string | null => {
  const language = normalizeLyricsLanguage(value)
  if (!isLyricsLanguage(language)) return lyricsLanguageValidationMessage
  const existing = props.slots.find(
    (slot) => slot.id !== excludingId && slot.language === language,
  )
  return existing ? `歌词语言 ${language} 已有一个槽位。每种语言只能保留一个槽位。` : null
}

const addSlot = (): void => {
  if (!props.editable) return
  const language = normalizeLyricsLanguage(newLanguage.value)
  const error = validateAvailableLanguage(language)
  if (error) {
    setInteractionError(error)
    return
  }
  emit('update', [
    ...props.slots,
    {
      id: slotId(),
      language,
      descriptor: '',
      representation: 'plain',
      text: '',
    },
  ])
  newLanguage.value = firstSuggestedLanguageNotInUse()
  setInteractionError()
}

const updateSlot = (id: string, patch: Partial<LyricsSlot>): void => {
  if (!props.editable) return
  emit(
    'update',
    props.slots.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
  )
}

const updateSlotLanguage = (slot: LyricsSlot, value: string): void => {
  if (!props.editable) return
  const language = normalizeLyricsLanguage(value)
  const error = validateAvailableLanguage(language, slot.id)
  if (error) {
    setInteractionError(error)
    return
  }
  updateSlot(slot.id, { language })
  setInteractionError()
}

const removeSlot = (id: string): void => {
  if (!props.editable) return
  emit(
    'update',
    props.slots.filter((slot) => slot.id !== id),
  )
  setInteractionError()
}

const originalSlotFor = (slot: LyricsSlot): LyricsSlot | undefined =>
  props.originalSlots.find((original) => original.id === slot.id)

const isChanged = (slot: LyricsSlot): boolean => {
  const original = originalSlotFor(slot)
  return !original || JSON.stringify(slot) !== JSON.stringify(original)
}

const restoreSlot = (slot: LyricsSlot): void => {
  if (!props.editable) return
  const original = originalSlotFor(slot)
  if (!original) {
    removeSlot(slot.id)
    return
  }
  emit(
    'update',
    props.slots.map((current) => (current.id === slot.id ? original : current)),
  )
  setInteractionError()
}

const sourceDescription = (slot: LyricsSlot): string | null => {
  const details = [
    slot.descriptor ? `描述：${slot.descriptor}` : '',
    slot.sourceCount && slot.sourceCount > 1 ? `已合并 ${slot.sourceCount} 个来源` : '',
  ].filter(Boolean)
  return details.join('；') || null
}

const duplicateLanguages = computed(() => duplicateLyricsLanguages(props.slots))
</script>

<template>
  <section class="lyrics-slot-manager" aria-labelledby="lyrics-heading">
    <div class="section-heading">
      <div>
        <p class="eyebrow">富内容</p>
        <h2 id="lyrics-heading">歌词</h2>
      </div>
      <span class="section-note">每种语言一个槽位，保留原文、换行和空行</span>
    </div>

    <div v-if="!props.editable && props.disabledReason" class="format-capability-notice">
      {{ props.disabledReason }}
    </div>

    <div class="lyrics-slot-add" :class="{ 'is-disabled': !props.editable }">
      <div class="field lyrics-add-language">
        <span class="field-label">添加歌词语言</span>
        <CreateSelect
          :model-value="newLanguage"
          :options="languageOptionsFor()"
          allow-create
          filter-disabled
          :disabled="!props.editable"
          aria-label="添加歌词语言"
          placeholder="und"
          @update:model-value="updateNewLanguage"
          @select="updateNewLanguage"
          @create="updateNewLanguage"
        />
        <span class="field-help">可搜索或创建语言码；已添加的语言不会重复显示。</span>
      </div>
      <button
        type="button"
        class="button button-secondary"
        :disabled="!props.editable"
        @click="addSlot"
      >
        <IconPlus :size="17" aria-hidden="true" />
        添加歌词槽位
      </button>
    </div>

    <p v-if="props.error || interactionError" class="field-error" role="alert">
      {{ interactionError || props.error }}
    </p>
    <p v-if="duplicateLanguages.length" class="field-error" role="alert">
      每种歌词语言只能有一个槽位：{{ duplicateLanguages.join('、') }} 已重复。
    </p>

    <div v-if="props.slots.length" class="lyrics-slot-list">
      <article v-for="(slot, index) in props.slots" :key="slot.id" class="lyrics-slot-card">
        <div class="lyrics-slot-heading">
          <div>
            <p class="field-label">歌词槽位 {{ index + 1 }}</p>
            <p v-if="sourceDescription(slot)" class="slot-source-description">
              {{ sourceDescription(slot) }}
            </p>
          </div>
          <div class="lyrics-slot-actions">
            <button
              v-if="isChanged(slot)"
              type="button"
              class="button button-secondary button-small"
              :disabled="!props.editable"
              @click="restoreSlot(slot)"
            >
              <IconRotate :size="15" aria-hidden="true" />
              {{ originalSlotFor(slot) ? '恢复' : '移除新增' }}
            </button>
            <button
              type="button"
              class="icon-button danger"
              :aria-label="`删除 ${slot.language} 歌词槽位`"
              :disabled="!props.editable"
              @click="removeSlot(slot.id)"
            >
              <IconX :size="18" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="lyrics-slot-fields">
          <div class="field lyrics-language-field">
            <span class="field-label">语言</span>
            <CreateSelect
              :model-value="slot.language"
              :options="languageOptionsFor(slot)"
              allow-create
              :disabled="!props.editable"
              :aria-label="`歌词槽位 ${index + 1} 的语言`"
              placeholder="输入或选择语言码"
              @select="updateSlotLanguage(slot, $event)"
              @create="updateSlotLanguage(slot, $event)"
            />
            <span class="field-help">已存在的其他语言不可选择，也可创建新语言码。</span>
          </div>
          <label class="field lyrics-text-field">
            <span class="field-label">歌词原文</span>
            <textarea
              :value="slot.text"
              rows="8"
              spellcheck="false"
              :disabled="!props.editable"
              @input="updateSlot(slot.id, { text: textareaValue($event) })"
            />
          </label>
        </div>
        <LyricsPreview :lyrics-slot="slot" />
      </article>
    </div>
    <div v-else class="lyrics-empty">
      还没有歌词槽位。选择语言后添加，即可分别维护不同语言的歌词。
    </div>
  </section>
</template>
