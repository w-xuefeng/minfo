<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  IconAlertTriangle,
  IconCheck,
  IconClipboard,
  IconDownload,
  IconLoader2,
  IconPlayerStop,
  IconRefresh,
  IconTerminal2,
} from '@tabler/icons-vue'

import {
  hasUnfilledLocalPaths,
  replacementCoversForLocalCommand,
  renderFfmpegCommand,
  type ShellDialect,
} from '@/application/ffmpeg-command'
import { exportPlanFingerprint } from '@/application/export-planner'
import {
  browserFallbackFormat,
  localFfmpegFormatOptions,
  type LocalFfmpegFormatOptionId,
} from '@/domain/audio-formats'
import type { FieldValidation } from '@/domain/metadata-validation'
import type { ExportPlan, ExportRequest, QueueItem, RuntimeStatus } from '@/domain/model'
import type { MediaExportProgress } from '@/infrastructure/browser-media-engine'

const props = defineProps<{
  item: QueueItem
  request: ExportRequest
  plan: ExportPlan | null
  runtime: RuntimeStatus
  errors: readonly FieldValidation[]
  progress: MediaExportProgress | null
  exportError: string
}>()

const emit = defineEmits<{
  'update-request': [request: ExportRequest]
  export: [plan: ExportPlan]
  retry: []
  'recheck-probe': []
  cancel: []
}>()

const dialect = ref<ShellDialect>('posix')
const localFormat = ref<LocalFfmpegFormatOptionId>('use-plan')
const customFormat = ref('')
const copied = ref(false)
const actionError = ref('')
const acknowledged = ref(false)
const exportErrorPanel = ref<HTMLElement | null>(null)
const paths = reactive<{
  sourcePath: string
  outputPath: string
  coverPaths: Record<string, string>
}>({
  sourcePath: '',
  outputPath: '',
  coverPaths: {},
})

const confirmationKey = computed(() => {
  const plan = props.plan
  return plan ? exportPlanFingerprint(plan) : ''
})

watch(confirmationKey, () => {
  acknowledged.value = false
  actionError.value = ''
})

watch(
  () => props.item.id,
  () => {
    paths.sourcePath = ''
    paths.outputPath = ''
    paths.coverPaths = {}
    localFormat.value = 'use-plan'
    customFormat.value = ''
    copied.value = false
  },
)

watch(
  () => props.exportError,
  async (error, previousError) => {
    if (!error || error === previousError) return
    await nextTick()
    const panel = exportErrorPanel.value
    if (!panel) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
    panel.focus({ preventScroll: true })
  },
)

const confirmationRisks = computed(
  () => props.plan?.risks.filter((risk) => risk.requiresConfirmation) ?? [],
)

const browserTarget = computed(() => props.plan?.resolvedFormat?.toUpperCase() ?? '未支持')

const probeDiagnosticStage = computed(() => {
  switch (props.item.probeDiagnostic?.stage) {
    case 'runtime':
      return '媒体运行时'
    case 'input':
      return '写入临时输入文件'
    case 'ffprobe':
      return 'FFprobe'
    case 'output':
      return '读取 FFprobe 输出'
    default:
      return '未验证'
  }
})

const canRecommendFallback = computed(
  () =>
    props.request.format !== browserFallbackFormat.id &&
    props.plan?.risks.some(
      (risk) => risk.id === 'unsupported-target' || risk.id === 'aac-cover-omitted',
    ),
)

const hasConfirmationRisks = computed(() => confirmationRisks.value.length > 0)

const localExtension = computed(() => {
  if (localFormat.value === 'use-plan') return ''
  if (localFormat.value === 'custom') return customFormat.value
  return localFormat.value
})

const commandResult = computed(() => {
  if (!props.plan) return { text: '', error: '' }
  try {
    return {
      text: renderFfmpegCommand({
        dialect: dialect.value,
        plan: props.plan,
        draft: props.item.draft,
        originalDraft: props.item.originalDraft,
        nativeTags: props.item.nativeTags,
        sourceName: props.item.identity.name,
        customFormat: localExtension.value,
        allowOverwrite: props.request.allowOverwrite,
        paths,
      }),
      error: '',
    }
  } catch (error) {
    return { text: '', error: error instanceof Error ? error.message : '无法生成本机命令。' }
  }
})

const command = computed(() => commandResult.value.text)
const commandError = computed(() => commandResult.value.error)

const localPathsMissing = computed(() => {
  if (!props.plan) return true
  return hasUnfilledLocalPaths({
    dialect: dialect.value,
    plan: props.plan,
    draft: props.item.draft,
    originalDraft: props.item.originalDraft,
    nativeTags: props.item.nativeTags,
    sourceName: props.item.identity.name,
    customFormat: localExtension.value,
    allowOverwrite: props.request.allowOverwrite,
    paths,
  })
})

const localReplacementCovers = computed(() => {
  if (!props.plan) return []
  try {
    return replacementCoversForLocalCommand({
      dialect: dialect.value,
      plan: props.plan,
      draft: props.item.draft,
      originalDraft: props.item.originalDraft,
      nativeTags: props.item.nativeTags,
      sourceName: props.item.identity.name,
      customFormat: localExtension.value,
      allowOverwrite: props.request.allowOverwrite,
      paths,
    })
  } catch {
    return []
  }
})

const canExport = computed(
  () =>
    Boolean(props.plan?.runnable) &&
    props.errors.length === 0 &&
    (confirmationRisks.value.length === 0 || acknowledged.value),
)

const updateRequest = (patch: Partial<ExportRequest>): void => {
  emit('update-request', { ...props.request, ...patch })
}

const recommendFallback = (): void => {
  updateRequest({ format: browserFallbackFormat.id })
}

const updateOverwrite = (event: Event): void => {
  updateRequest({ allowOverwrite: (event.target as HTMLInputElement).checked })
}

const copy = async (): Promise<void> => {
  copied.value = false
  actionError.value = ''
  try {
    if (!command.value || commandError.value)
      throw new Error(commandError.value || '命令不可用。')
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(command.value)
    } else {
      const area = document.createElement('textarea')
      area.value = command.value
      area.className = 'visually-hidden'
      document.body.append(area)
      area.select()
      if (!document.execCommand('copy')) throw new Error('浏览器拒绝复制。')
      area.remove()
    }
    copied.value = true
  } catch (error) {
    actionError.value =
      error instanceof Error && error.message
        ? error.message
        : '未能自动复制。请在下方脚本框中手动选择并复制。'
  }
}

const runExport = (): void => {
  actionError.value = ''
  if (!props.plan) return
  if (props.errors.length) {
    actionError.value = props.errors[0]?.message ?? '请修正表单错误。'
    return
  }
  if (confirmationRisks.value.length && !acknowledged.value) {
    actionError.value = '请勾选“我已知晓，坚持导出”以确认当前副本影响。'
    return
  }
  if (!props.plan.runnable) {
    actionError.value = '当前浏览器无法生成此导出文件。请查看预检原因，或复制本机 FFmpeg 脚本。'
    return
  }
  emit('export', props.plan)
}

const updateCoverPath = (coverId: string, event: Event): void => {
  const target = event.target as HTMLInputElement
  paths.coverPaths = { ...paths.coverPaths, [coverId]: target.value }
}

const progressText = computed(() => {
  if (!props.progress) return ''
  const label =
    props.progress.stage === 'preparing'
      ? '准备文件'
      : props.progress.stage === 'processing'
        ? '正在处理'
        : '正在验证'
  return `${label} ${Math.round(props.progress.ratio * 100)}%`
})
</script>

<template>
  <section class="export-panel panel" aria-labelledby="export-heading">
    <div class="section-heading">
      <div>
        <p class="eyebrow">导出</p>
        <h2 id="export-heading">预检与输出</h2>
      </div>
      <span class="runtime-badge" :class="`is-${props.runtime.state}`">
        <IconLoader2
          v-if="props.runtime.state === 'preparing'"
          :size="15"
          class="spin"
          aria-hidden="true"
        />
        {{
          props.runtime.state === 'ready'
            ? '运行时就绪'
            : props.runtime.state === 'preparing'
              ? '准备运行时'
              : '运行时不可用'
        }}
      </span>
    </div>

    <div
      class="preflight-box"
      :class="{
        'has-error': !props.plan?.runnable,
        'has-warning': props.plan?.runnable && hasConfirmationRisks,
      }"
    >
      <p class="field-label">当前预检</p>
      <p class="preflight-summary">{{ props.plan?.summary ?? '等待文件读取完成。' }}</p>
      <dl v-if="props.plan" class="preflight-facts">
        <div>
          <dt>浏览器目标</dt>
          <dd>{{ browserTarget }}</dd>
        </div>
        <div>
          <dt>音频路径</dt>
          <dd>{{ props.plan.requiresTranscode ? '重新编码' : '流复制' }}</dd>
        </div>
        <div>
          <dt>运行时</dt>
          <dd>{{ props.plan.runtimeVersion }}</dd>
        </div>
      </dl>
    </div>

    <div v-if="props.plan?.risks.length" class="risk-list" aria-label="导出风险">
      <div
        v-for="risk in props.plan.risks"
        :key="risk.id"
        class="risk-item"
        :class="{ required: risk.requiresConfirmation }"
      >
        <IconAlertTriangle :size="18" aria-hidden="true" />
        <div>
          <strong>{{ risk.title }}</strong>
          <p>{{ risk.description }}</p>
        </div>
      </div>
    </div>

    <details v-if="props.item.probeDiagnostic" class="probe-diagnostic" open>
      <summary>
        <span><IconAlertTriangle :size="17" aria-hidden="true" />媒体探测详情</span>
        <span>{{ probeDiagnosticStage }}</span>
      </summary>
      <div class="probe-diagnostic-body">
        <dl class="probe-diagnostic-facts">
          <div>
            <dt>检查阶段</dt>
            <dd>{{ probeDiagnosticStage }}</dd>
          </div>
          <div v-if="props.item.probeDiagnostic.exitCode !== undefined">
            <dt>退出码</dt>
            <dd>{{ props.item.probeDiagnostic.exitCode }}</dd>
          </div>
          <div>
            <dt>FFprobe 容器</dt>
            <dd>未验证</dd>
          </div>
          <div>
            <dt>FFprobe 编码</dt>
            <dd>未验证</dd>
          </div>
        </dl>
        <p class="probe-diagnostic-summary">{{ props.item.probeDiagnostic.summary }}</p>
        <pre
          v-if="props.item.probeDiagnostic.logLines.length"
          class="probe-diagnostic-log"
        ><code>{{
          props.item.probeDiagnostic.logLines.join('\n')
        }}</code></pre>
        <p v-else class="inline-note">FFprobe 未返回额外的错误文本。</p>
        <div class="probe-diagnostic-actions">
          <p class="inline-note">
            可重新检查一次。若仍失败，请复制本机 FFmpeg 命令，并在本机用 FFprobe 检查该文件。
          </p>
          <button
            type="button"
            class="button button-secondary button-small"
            @click="emit('recheck-probe')"
          >
            <IconRefresh :size="16" aria-hidden="true" />重新检查
          </button>
        </div>
      </div>
    </details>

    <div v-if="canRecommendFallback" class="format-fallback">
      <div>
        <strong>推荐兼容格式：{{ browserFallbackFormat.label }}</strong>
        <p>
          改用
          {{ browserFallbackFormat.label }}
          可能保留当前目标无法承载的字段。也可以确认风险后继续导出当前的新副本。
        </p>
      </div>
      <button
        type="button"
        class="button button-secondary button-small"
        @click="recommendFallback"
      >
        改用 {{ browserFallbackFormat.label }}
      </button>
    </div>

    <label v-if="confirmationRisks.length" class="confirmation-panel">
      <input v-model="acknowledged" type="checkbox" />
      <span>
        <strong>我已知晓，坚持导出。</strong>
        我了解上述影响只发生在将要生成的新副本，源文件不会被修改；确认仅适用于此文件、当前草稿版本、目标格式与运行时版本，修改任一项后需要再次确认。
      </span>
    </label>

    <p v-if="props.progress" class="export-progress" role="status">{{ progressText }}</p>
    <p v-if="actionError" class="field-error" role="alert">{{ actionError }}</p>
    <div
      v-if="props.exportError"
      ref="exportErrorPanel"
      class="export-outcome is-error"
      tabindex="-1"
      role="alert"
    >
      <IconAlertTriangle :size="20" aria-hidden="true" />
      <div>
        <strong>导出未完成</strong>
        <p>{{ props.exportError }}</p>
        <p class="inline-note">未下载任何输出文件；当前草稿和导出设置仍保留，可修改后重试。</p>
      </div>
    </div>
    <div class="export-actions">
      <button
        v-if="props.progress"
        type="button"
        class="button button-danger"
        @click="emit('cancel')"
      >
        <IconPlayerStop :size="18" aria-hidden="true" />
        取消当前任务
      </button>
      <button
        v-else
        type="button"
        class="button button-primary"
        :disabled="!canExport"
        @click="runExport"
      >
        <IconDownload :size="18" aria-hidden="true" />
        {{ hasConfirmationRisks && !acknowledged ? '确认后导出文件' : '导出文件' }}
      </button>
      <button
        v-if="props.runtime.state !== 'ready'"
        type="button"
        class="button button-secondary"
        :disabled="props.runtime.state === 'preparing'"
        @click="emit('retry')"
      >
        <IconRefresh :size="18" aria-hidden="true" />
        重试运行时
      </button>
    </div>

    <details class="command-panel">
      <summary>
        <span><IconTerminal2 :size="18" aria-hidden="true" />复制 FFmpeg 命令</span>
        <span>本机执行</span>
      </summary>
      <p class="inline-note">
        浏览器无法读取真实本地路径。这里的路径由你填写，脚本会在占位符或空路径仍存在时停止，不会执行
        FFmpeg。当前目标会省略的封面不会要求路径。
      </p>

      <div class="command-options">
        <label class="field">
          <span class="field-label">终端方言</span>
          <select v-model="dialect">
            <option value="posix">zsh / bash</option>
            <option value="powershell">Windows PowerShell</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">本机输出格式</span>
          <select v-model="localFormat">
            <option
              v-for="option in localFfmpegFormatOptions"
              :key="option.id"
              :value="option.id"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label v-if="localFormat === 'custom'" class="field">
          <span class="field-label">自定义扩展名</span>
          <input v-model="customFormat" placeholder="例如 opus" autocapitalize="none" />
          <span class="field-help">这是本机 FFmpeg 能力，浏览器未验证。</span>
        </label>
      </div>

      <div class="command-paths">
        <label class="field field-wide">
          <span class="field-label">源音频路径</span>
          <input
            v-model="paths.sourcePath"
            placeholder="__MINFO_SOURCE_PATH__"
            autocapitalize="none"
          />
        </label>
        <label class="field field-wide">
          <span class="field-label">输出路径</span>
          <input
            v-model="paths.outputPath"
            placeholder="__MINFO_OUTPUT_PATH__"
            autocapitalize="none"
          />
        </label>
        <label
          v-for="(cover, index) in localReplacementCovers"
          :key="cover.id"
          class="field field-wide"
        >
          <span class="field-label">替换封面 {{ index + 1 }} 的本地路径</span>
          <input
            :value="paths.coverPaths[cover.id] ?? ''"
            :placeholder="`__MINFO_COVER_${index + 1}_PATH__`"
            autocapitalize="none"
            @input="updateCoverPath(cover.id, $event)"
          />
        </label>
      </div>

      <label class="overwrite-toggle">
        <input
          type="checkbox"
          :checked="props.request.allowOverwrite"
          @change="updateOverwrite"
        />
        <span>允许本机脚本覆盖已有输出文件（否则使用 <code>-n</code>）</span>
      </label>
      <p v-if="localPathsMissing" class="inline-note">
        路径还未填写，复制的脚本将保留安全占位符并在运行前提示。
      </p>
      <p v-if="commandError" class="field-error" role="alert">{{ commandError }}</p>

      <div class="command-copy-row">
        <button
          type="button"
          class="button button-secondary"
          :disabled="Boolean(commandError)"
          @click="copy"
        >
          <IconCheck v-if="copied" :size="18" aria-hidden="true" />
          <IconClipboard v-else :size="18" aria-hidden="true" />
          {{ copied ? '已复制' : '复制脚本' }}
        </button>
        <span>脚本结束后会用 FFprobe 输出容器与音频流 JSON。</span>
      </div>
      <pre v-if="command" class="command-code"><code>{{ command }}</code></pre>
    </details>
  </section>
</template>
