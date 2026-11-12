<script setup lang="ts">
import { ref } from 'vue'
import { IconFileMusic, IconUpload } from '@tabler/icons-vue'

const emit = defineEmits<{
  files: [files: File[]]
}>()

const input = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)

const openPicker = (): void => input.value?.click()

const addFiles = (files: FileList | null): void => {
  if (files?.length) emit('files', [...files])
}

const onInput = (event: Event): void => {
  const target = event.target as HTMLInputElement
  addFiles(target.files)
  target.value = ''
}

const onDrop = (event: DragEvent): void => {
  isDragging.value = false
  addFiles(event.dataTransfer?.files ?? null)
}
</script>

<template>
  <section
    class="file-dropzone"
    :class="{ 'is-dragging': isDragging }"
    aria-describedby="dropzone-hint"
    @dragenter.prevent="isDragging = true"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
  >
    <div class="dropzone-mark" aria-hidden="true">
      <IconFileMusic :size="30" :stroke-width="1.5" />
    </div>
    <div>
      <p class="eyebrow">本地文件工作区</p>
      <h2>{{ isDragging ? '松开以加入音频文件' : '把音频文件放到这里' }}</h2>
      <p id="dropzone-hint" class="muted">
        支持选择多个文件，MINFO 会按顺序读取。源文件始终保持不变。
      </p>
    </div>
    <button type="button" class="button button-primary" @click="openPicker">
      <IconUpload :size="18" aria-hidden="true" />
      选择音频文件
    </button>
    <input
      ref="input"
      class="visually-hidden"
      type="file"
      accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.oga,.opus,.wma,.ape,.amr,.mid,.midi,.alac"
      multiple
      @change="onInput"
    />
  </section>
</template>
