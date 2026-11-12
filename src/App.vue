<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  IconAlertCircle,
  IconCircleCheck,
  IconFilePlus,
  IconInfoCircle,
  IconMoon,
  IconShieldCheck,
  IconSun,
  IconX,
} from '@tabler/icons-vue'

import ExportPanel from './components/ExportPanel.vue'
import ExportFormatSelector from './components/ExportFormatSelector.vue'
import ConflictPanel from './components/ConflictPanel.vue'
import FileDropzone from './components/FileDropzone.vue'
import MetadataEditor from './components/MetadataEditor.vue'
import QueueSidebar from './components/QueueSidebar.vue'
import TechnicalSummary from './components/TechnicalSummary.vue'
import { createWorkspace } from '@/application/workspace'
import { defaultOutputBaseName } from '@/domain/format'
import { formCapabilitiesForOutput } from '@/domain/editable-form-capabilities'
import type { CoverArtwork, ExportPlan, ExportRequest, MetadataDraft } from '@/domain/model'
import type { RawTagConflict } from '@/application/metadata-diff'

const workspace = createWorkspace()
const picker = ref<HTMLInputElement | null>(null)
const darkMode = ref(false)
const exportRequest = ref<ExportRequest>({
  format: 'original',
  quality: 'high',
  outputBaseName: '',
  allowOverwrite: false,
})

const selected = workspace.selected
const plan = computed(() =>
  selected.value ? workspace.getPlan(selected.value.id, exportRequest.value) : null,
)
const formCapabilities = computed(() => formCapabilitiesForOutput(plan.value?.resolvedFormat))
const validation = computed(() =>
  selected.value ? workspace.getValidation(selected.value.id) : [],
)
const conflicts = computed(() =>
  selected.value ? workspace.getConflicts(selected.value.id) : [],
)

const pickerAccept =
  'audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.oga,.opus,.wma,.ape,.amr,.mid,.midi,.alac'

const setTheme = (dark: boolean): void => {
  darkMode.value = dark
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  try {
    localStorage.setItem('minfo-theme', dark ? 'dark' : 'light')
  } catch {
    // Theme preference is a convenience only.
  }
}

const addFiles = (files: File[]): void => workspace.addFiles(files)

const openPicker = (): void => picker.value?.click()

const onPicker = (event: Event): void => {
  const target = event.target as HTMLInputElement
  addFiles([...((target.files ?? []) as FileList)])
  target.value = ''
}

const applyRequest = (request: ExportRequest): void => {
  exportRequest.value = request
}

const exportItem = (exportPlan: ExportPlan): void => {
  if (!selected.value) return
  void workspace.export(selected.value.id, exportPlan).catch(() => {
    // The workspace publishes a visible error notice and item-level status.
  })
}

const updateDraft = (patch: Partial<MetadataDraft>): void => {
  if (selected.value) workspace.updateDraft(selected.value.id, patch)
}

const addCover = (cover: CoverArtwork): void => {
  if (selected.value) workspace.addCover(selected.value.id, cover)
}

const replaceCover = (coverId: string, cover: CoverArtwork): void => {
  if (selected.value) workspace.replaceCover(selected.value.id, coverId, cover)
}

const updateCover = (coverId: string, patch: Partial<CoverArtwork>): void => {
  if (selected.value) workspace.updateCover(selected.value.id, coverId, patch)
}

const removeCover = (coverId: string): void => {
  if (selected.value) workspace.removeCover(selected.value.id, coverId)
}

const moveCover = (coverId: string, direction: -1 | 1): void => {
  if (selected.value) workspace.moveCover(selected.value.id, coverId, direction)
}

const resolveConflict = (conflict: RawTagConflict, resolution: 'standard' | 'raw'): void => {
  if (selected.value) workspace.resolveConflict(selected.value.id, conflict, resolution)
}

watch(
  () => selected.value?.id,
  () => {
    if (!selected.value) return
    exportRequest.value = {
      format: 'original',
      quality: 'high',
      outputBaseName: defaultOutputBaseName(selected.value.identity.name),
      allowOverwrite: false,
    }
  },
)

onMounted(() => {
  try {
    const stored = localStorage.getItem('minfo-theme')
    setTheme(
      stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches,
    )
  } catch {
    setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches)
  }
  workspace.start()
  window.addEventListener('beforeunload', confirmUnload)
})

const confirmUnload = (event: BeforeUnloadEvent): void => {
  if (workspace.items.value.some((item) => item.status === 'processing')) {
    event.preventDefault()
    event.returnValue = ''
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', confirmUnload)
  workspace.dispose()
})
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <a class="brand" href="#workspace" aria-label="MINFO 音乐信息工作台">
        <span class="brand-mark" aria-hidden="true">M</span>
        <span>
          <strong>MINFO</strong>
          <small>Music Information</small>
        </span>
      </a>
      <div class="header-actions">
        <span class="privacy-note"
          ><IconShieldCheck :size="16" aria-hidden="true" />文件不会上传</span
        >
        <button
          type="button"
          class="icon-button theme-button"
          :aria-label="darkMode ? '切换到浅色主题' : '切换到深色主题'"
          @click="setTheme(!darkMode)"
        >
          <IconSun v-if="darkMode" :size="19" aria-hidden="true" />
          <IconMoon v-else :size="19" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main id="workspace" class="workspace">
      <aside
        v-if="workspace.notice.value"
        class="app-notice"
        :class="`is-${workspace.notice.value.kind}`"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <IconAlertCircle
          v-if="workspace.notice.value.kind === 'error'"
          :size="19"
          aria-hidden="true"
        />
        <IconCircleCheck
          v-else-if="workspace.notice.value.kind === 'success'"
          :size="19"
          aria-hidden="true"
        />
        <IconInfoCircle v-else :size="19" aria-hidden="true" />
        <p>{{ workspace.notice.value.message }}</p>
        <button
          type="button"
          class="app-notice-close"
          aria-label="关闭通知"
          @click="workspace.dismissNotice"
        >
          <IconX :size="17" aria-hidden="true" />
        </button>
      </aside>

      <div class="workspace-grid">
        <QueueSidebar
          :items="workspace.items.value"
          :selected-id="workspace.selectedId.value"
          @select="workspace.select"
          @remove="workspace.remove"
          @add="openPicker"
        />

        <section class="workspace-main">
          <FileDropzone v-if="!selected" @files="addFiles" />

          <template v-else>
            <div class="file-heading">
              <div>
                <p class="eyebrow">当前文件</p>
                <h1>{{ selected.identity.name }}</h1>
                <p class="muted">编辑草稿仅存于本次浏览器会话。导出会创建新文件。</p>
              </div>
              <button
                type="button"
                class="button button-secondary button-small"
                @click="openPicker"
              >
                <IconFilePlus :size="17" aria-hidden="true" />
                加入文件
              </button>
            </div>

            <div
              v-if="selected.status === 'queued' || selected.status === 'inspecting'"
              class="processing-banner"
              role="status"
            >
              正在读取嵌入元信息，队列会一次处理一个文件。
            </div>
            <div
              v-if="selected.error && selected.status !== 'failed'"
              class="diagnostic-banner"
              role="alert"
            >
              <IconAlertCircle :size="20" aria-hidden="true" />
              <div>
                <strong>读取未完整完成</strong>
                <p>{{ selected.error }}</p>
              </div>
            </div>
            <ul v-if="selected.warnings.length" class="warning-list" aria-label="读取警告">
              <li v-for="warning in selected.warnings" :key="warning">{{ warning }}</li>
            </ul>

            <div class="overview-grid">
              <TechnicalSummary :item="selected" />
              <section class="panel source-panel" aria-labelledby="source-heading">
                <p class="eyebrow">文件保护</p>
                <h2 id="source-heading">源文件只读</h2>
                <p>
                  MINFO 不会就地改写所选音频。所有浏览器导出会生成一个新文件；本机命令也默认使用
                  <code>-n</code> 防止覆盖。
                </p>
                <p class="inline-note">浏览器运行时：{{ workspace.runtime.value.message }}</p>
              </section>
            </div>

            <template v-if="selected.status !== 'queued' && selected.status !== 'inspecting'">
              <template v-if="selected.status !== 'processing'">
                <ExportFormatSelector
                  :item="selected"
                  :request="exportRequest"
                  :plan="plan"
                  :capabilities="formCapabilities"
                  @update-request="applyRequest"
                />

                <MetadataEditor
                  :item="selected"
                  :errors="validation"
                  :capabilities="formCapabilities"
                  @update="updateDraft"
                  @restore="workspace.restoreDraftField(selected.id, $event)"
                  @add-cover="addCover"
                  @replace-cover="replaceCover"
                  @update-cover="updateCover"
                  @remove-cover="removeCover"
                  @move-cover="moveCover"
                />

                <ConflictPanel :conflicts="conflicts" @resolve="resolveConflict" />
              </template>

              <ExportPanel
                :item="selected"
                :request="exportRequest"
                :plan="plan"
                :runtime="workspace.runtime.value"
                :errors="validation"
                :progress="workspace.exportProgress.value"
                :export-error="selected.status === 'failed' ? (selected.error ?? '') : ''"
                @update-request="applyRequest"
                @export="exportItem"
                @retry="workspace.retryRuntime"
                @recheck-probe="workspace.recheckProbe(selected.id)"
                @cancel="workspace.cancelCurrent"
              />
            </template>
          </template>
        </section>
      </div>
    </main>

    <input
      ref="picker"
      class="visually-hidden"
      type="file"
      :accept="pickerAccept"
      multiple
      @change="onPicker"
    />
  </div>
</template>
