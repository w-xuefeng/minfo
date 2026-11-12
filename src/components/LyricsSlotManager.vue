<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { IconLoader2, IconPlus, IconRotate, IconUpload, IconX } from '@tabler/icons-vue'

import CreateSelect, { type CreateSelectOption } from './CreateSelect.vue'
import LyricsPreview from './LyricsPreview.vue'
import {
  lyricsFileAccept,
  lyricsFileFormatLabel,
  parseLyricsFile,
  type LyricsFileParseSuccess,
} from '@/domain/lyric-file'
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

interface PendingLyricsFileImport {
  readonly slotId: string
  readonly language: string
  readonly fileName: string
  readonly parsed: LyricsFileParseSuccess
}

const lyricsFileInput = ref<HTMLInputElement | null>(null)
const lyricsImportDialog = ref<HTMLElement | null>(null)
const lyricsImportTargetSlotId = ref<string | null>(null)
const lyricsImportInProgressSlotId = ref<string | null>(null)
const lyricsImportErrors = ref<Record<string, string>>({})
const lyricsImportNotices = ref<Record<string, string>>({})
const pendingLyricsFileImport = ref<PendingLyricsFileImport | null>(null)
let lyricsImportRequest = 0

const suggestedLanguageSet = new Set<string>(suggestedLyricsLanguages)

const languageOptions = computed<readonly string[]>(() => [
  ...suggestedLyricsLanguages,
  ...[...new Set(props.slots.map((slot) => slot.language))]
    .filter((language) => !suggestedLanguageSet.has(language))
    .sort(),
])

const textareaValue = (event: Event): string => (event.target as HTMLTextAreaElement).value

const lyricsTextareaId = (slot: LyricsSlot): string => `lyrics-text-${slot.id}`
const lyricsImportErrorId = (slot: LyricsSlot): string => `lyrics-import-error-${slot.id}`
const lyricsImportNoticeId = (slot: LyricsSlot): string => `lyrics-import-notice-${slot.id}`
const lyricsImportFeedbackId = (slot: LyricsSlot): string | undefined => {
  if (lyricsImportErrors.value[slot.id]) return lyricsImportErrorId(slot)
  if (lyricsImportNotices.value[slot.id]) return lyricsImportNoticeId(slot)
  return undefined
}

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

const clearLyricsImportFeedback = (slotId: string): void => {
  const errors = { ...lyricsImportErrors.value }
  const notices = { ...lyricsImportNotices.value }
  delete errors[slotId]
  delete notices[slotId]
  lyricsImportErrors.value = errors
  lyricsImportNotices.value = notices
}

const setLyricsImportError = (slotId: string, message: string): void => {
  const notices = { ...lyricsImportNotices.value }
  delete notices[slotId]
  lyricsImportNotices.value = notices
  lyricsImportErrors.value = { ...lyricsImportErrors.value, [slotId]: message }
}

const setLyricsImportNotice = (slotId: string, message: string): void => {
  const errors = { ...lyricsImportErrors.value }
  delete errors[slotId]
  lyricsImportErrors.value = errors
  lyricsImportNotices.value = { ...lyricsImportNotices.value, [slotId]: message }
}

const applyLyricsFileImport = (candidate: PendingLyricsFileImport): void => {
  const slot = props.slots.find((item) => item.id === candidate.slotId)
  pendingLyricsFileImport.value = null
  if (!slot || !props.editable) return

  updateSlot(slot.id, {
    text: candidate.parsed.text,
    representation: candidate.parsed.representation,
  })
  setLyricsImportNotice(slot.id, candidate.parsed.notice)
}

const openLyricsFilePicker = (slot: LyricsSlot): void => {
  if (!props.editable || lyricsImportInProgressSlotId.value) return
  clearLyricsImportFeedback(slot.id)
  pendingLyricsFileImport.value = null
  lyricsImportTargetSlotId.value = slot.id
  lyricsFileInput.value?.click()
}

const onLyricsFileSelected = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const slotId = lyricsImportTargetSlotId.value
  input.value = ''
  lyricsImportTargetSlotId.value = null
  if (!file || !slotId || !props.editable) return

  const request = ++lyricsImportRequest
  lyricsImportInProgressSlotId.value = slotId
  clearLyricsImportFeedback(slotId)

  try {
    const parsed = await parseLyricsFile(file)
    if (request !== lyricsImportRequest || !props.editable) return
    if (!parsed.ok) {
      setLyricsImportError(slotId, parsed.error)
      return
    }

    const slot = props.slots.find((item) => item.id === slotId)
    if (!slot) return
    const candidate: PendingLyricsFileImport = {
      slotId,
      language: slot.language,
      fileName: file.name,
      parsed,
    }
    if (slot.text.trim()) {
      pendingLyricsFileImport.value = candidate
      return
    }
    applyLyricsFileImport(candidate)
  } catch {
    if (request === lyricsImportRequest) {
      setLyricsImportError(slotId, '读取歌词文件时发生意外错误，请重新选择该文件。')
    }
  } finally {
    if (request === lyricsImportRequest) {
      lyricsImportInProgressSlotId.value = null
    }
  }
}

const cancelLyricsFileImport = (): void => {
  const candidate = pendingLyricsFileImport.value
  pendingLyricsFileImport.value = null
  if (candidate) setLyricsImportNotice(candidate.slotId, '已取消替换，当前歌词未变。')
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

watch(pendingLyricsFileImport, async (candidate) => {
  if (!candidate) return
  await nextTick()
  lyricsImportDialog.value?.focus()
})
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

    <input
      ref="lyricsFileInput"
      class="visually-hidden"
      type="file"
      :accept="lyricsFileAccept"
      :disabled="!props.editable"
      @change="onLyricsFileSelected"
    />

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
          <div class="field lyrics-text-field">
            <div class="lyrics-text-heading">
              <label class="field-label" :for="lyricsTextareaId(slot)">歌词原文</label>
              <button
                type="button"
                class="button button-secondary button-small lyrics-import-button"
                :aria-label="`为 ${slot.language} 歌词槽位解析歌词文件`"
                :aria-busy="lyricsImportInProgressSlotId === slot.id"
                :disabled="!props.editable || lyricsImportInProgressSlotId !== null"
                @click="openLyricsFilePicker(slot)"
              >
                <IconLoader2
                  v-if="lyricsImportInProgressSlotId === slot.id"
                  class="spin"
                  :size="15"
                  aria-hidden="true"
                />
                <IconUpload v-else :size="15" aria-hidden="true" />
                {{ lyricsImportInProgressSlotId === slot.id ? '正在解析…' : '解析歌词文件' }}
              </button>
            </div>
            <textarea
              :id="lyricsTextareaId(slot)"
              :value="slot.text"
              rows="8"
              spellcheck="false"
              :disabled="!props.editable"
              :aria-describedby="lyricsImportFeedbackId(slot)"
              @input="updateSlot(slot.id, { text: textareaValue($event) })"
            />
            <span class="field-help">支持 .txt、.lrc 和明文 .qrc，最大 2 MB。</span>
            <p
              v-if="lyricsImportErrors[slot.id]"
              :id="lyricsImportErrorId(slot)"
              class="field-error lyrics-import-feedback"
              role="alert"
            >
              {{ lyricsImportErrors[slot.id] }}
            </p>
            <p
              v-else-if="lyricsImportNotices[slot.id]"
              :id="lyricsImportNoticeId(slot)"
              class="field-success lyrics-import-feedback"
              role="status"
            >
              {{ lyricsImportNotices[slot.id] }}
            </p>
          </div>
        </div>
        <LyricsPreview :lyrics-slot="slot" />
      </article>
    </div>
    <div v-else class="lyrics-empty">
      还没有歌词槽位。选择语言后添加，即可分别维护不同语言的歌词。
    </div>

    <div
      v-if="pendingLyricsFileImport"
      class="lyrics-import-dialog-backdrop"
      @keydown.esc.prevent="cancelLyricsFileImport"
    >
      <section
        ref="lyricsImportDialog"
        class="lyrics-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lyrics-import-dialog-title"
        aria-describedby="lyrics-import-dialog-description"
        tabindex="-1"
      >
        <p class="eyebrow">替换前确认</p>
        <h3 id="lyrics-import-dialog-title">替换当前歌词？</h3>
        <p id="lyrics-import-dialog-description">
          将使用“{{ pendingLyricsFileImport.fileName }}”（{{
            lyricsFileFormatLabel(pendingLyricsFileImport.parsed.format)
          }}）替换 {{ pendingLyricsFileImport.language }} 槽位中的现有歌词。
        </p>
        <p class="field-help">{{ pendingLyricsFileImport.parsed.notice }}</p>
        <div class="lyrics-import-dialog-actions">
          <button type="button" class="button button-secondary" @click="cancelLyricsFileImport">
            取消
          </button>
          <button
            type="button"
            class="button button-primary"
            @click="applyLyricsFileImport(pendingLyricsFileImport)"
          >
            替换当前歌词
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
