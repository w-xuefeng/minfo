<script setup lang="ts">
import { computed } from 'vue'
import { IconAdjustments, IconFileExport } from '@tabler/icons-vue'

import { qualityFor } from '@/application/ffmpeg-arguments'
import { browserExportFormatOptions, getBrowserAudioFormat } from '@/domain/audio-formats'
import {
  disabledEditableMetadataFields,
  editableMetadataFormFieldLabels,
  type EditableFormCapabilities,
} from '@/domain/editable-form-capabilities'
import { getRequestedOutputExtension } from '@/domain/format'
import type { ExportPlan, ExportRequest, QueueItem } from '@/domain/model'

const props = defineProps<{
  item: QueueItem
  request: ExportRequest
  plan: ExportPlan | null
  capabilities: EditableFormCapabilities
}>()

const emit = defineEmits<{
  'update-request': [request: ExportRequest]
}>()

const requestedTarget = computed(() => {
  const extension =
    props.plan?.requestedExtension ??
    getRequestedOutputExtension(props.request, props.item.identity.name)
  return extension ? `.${extension}` : '等待格式探测'
})

const outputDescription = computed(() => {
  if (!props.plan?.resolvedFormat) {
    return '保持原格式时会在文件探测完成后确定实际输出容器。'
  }

  const format = getBrowserAudioFormat(props.plan.resolvedFormat)
  return `${format.label} 输出为 ${format.containerDescription}（.${format.outputExtension}）。`
})

const qualitySummary = computed(() => {
  if (!props.plan?.resolvedFormat || !props.plan.requiresTranscode) return ''
  const quality = qualityFor(props.plan.resolvedFormat, props.request.quality)
  return `${quality.encoder} · ${quality.label} · 预设 ${quality.presetVersion}`
})

const disabledFields = computed(() =>
  disabledEditableMetadataFields(props.capabilities).map((field) => ({
    field,
    label: editableMetadataFormFieldLabels[field],
    reason: props.capabilities[field].disabledReason ?? '当前输出格式不支持编辑此字段。',
  })),
)

const updateRequest = (patch: Partial<ExportRequest>): void => {
  emit('update-request', { ...props.request, ...patch })
}

const updateFormat = (event: Event): void => {
  updateRequest({
    format: (event.target as HTMLSelectElement).value as ExportRequest['format'],
  })
}

const updateOutputBaseName = (event: Event): void => {
  updateRequest({ outputBaseName: (event.target as HTMLInputElement).value })
}

const updateQuality = (event: Event): void => {
  updateRequest({
    quality: (event.target as HTMLSelectElement).value as ExportRequest['quality'],
  })
}
</script>

<template>
  <section class="export-format-panel panel" aria-labelledby="export-target-heading">
    <div class="section-heading">
      <div>
        <p class="eyebrow">先选导出目标</p>
        <h2 id="export-target-heading">格式与输出</h2>
      </div>
      <IconFileExport :size="22" aria-hidden="true" />
    </div>

    <div class="export-format-grid">
      <label class="field">
        <span class="field-label">导出格式</span>
        <select :value="props.request.format" @change="updateFormat">
          <option
            v-for="option in browserExportFormatOptions"
            :key="option.id"
            :value="option.id"
          >
            {{ option.label }}
          </option>
        </select>
        <span class="field-help">
          浏览器输出格式仅限首发矩阵。其他格式可在下方本机 FFmpeg 命令中选择。
        </span>
      </label>

      <label class="field">
        <span class="field-label">输出文件名</span>
        <input
          :value="props.request.outputBaseName"
          aria-describedby="output-name-help"
          @input="updateOutputBaseName"
        />
        <span id="output-name-help" class="field-help">
          请求扩展名 {{ requestedTarget }}；浏览器下载为
          {{ props.plan?.outputFileName ?? '等待预检' }}
        </span>
      </label>

      <label v-if="props.plan?.requiresTranscode" class="field">
        <span class="field-label">转码质量</span>
        <select :value="props.request.quality" @change="updateQuality">
          <option value="high">高质量</option>
          <option value="balanced">平衡</option>
          <option value="compact">紧凑</option>
        </select>
        <span class="field-help">{{ qualitySummary }}</span>
      </label>
    </div>

    <div class="target-format-summary">
      <IconAdjustments :size="18" aria-hidden="true" />
      <p>{{ outputDescription }}</p>
    </div>

    <div v-if="disabledFields.length" class="format-capability-notice" role="status">
      <strong>当前目标会限制部分编辑</strong>
      <ul>
        <li v-for="field in disabledFields" :key="field.field">
          <span>{{ field.label }}</span>
          <span>{{ field.reason }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
