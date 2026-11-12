<script setup lang="ts">
import { IconFileInfo, IconMusic, IconStack2 } from '@tabler/icons-vue'

import type { QueueItem } from '@/domain/model'

const props = defineProps<{
  item: QueueItem
}>()

const formatDuration = (seconds: number | undefined): string => {
  if (seconds === undefined || !Number.isFinite(seconds)) return '未能读取'
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60)
  return `${minutes}:${String(rounded % 60).padStart(2, '0')}`
}

const formatBitrate = (bitrate: number | undefined): string =>
  bitrate === undefined ? '未能读取' : `${Math.round(bitrate / 1_000)} kb/s`

const formatBytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(2)} MB`
</script>

<template>
  <section class="summary-panel panel" aria-labelledby="technical-heading">
    <div class="section-heading compact">
      <div>
        <p class="eyebrow">只读信息</p>
        <h2 id="technical-heading">文件与音频</h2>
      </div>
      <IconFileInfo :size="20" aria-hidden="true" />
    </div>

    <dl class="technical-grid">
      <div>
        <dt>文件类型</dt>
        <dd>{{ props.item.technical?.extension?.toUpperCase() ?? '等待读取' }}</dd>
      </div>
      <div>
        <dt>大小</dt>
        <dd>{{ formatBytes(props.item.identity.size) }}</dd>
      </div>
      <div>
        <dt>持续时长</dt>
        <dd>{{ formatDuration(props.item.technical?.duration) }}</dd>
      </div>
      <div>
        <dt>容器</dt>
        <dd>{{ props.item.technical?.container ?? '等待读取' }}</dd>
      </div>
      <div>
        <dt>编解码器</dt>
        <dd>
          <IconMusic :size="15" aria-hidden="true" />
          {{ props.item.technical?.codec ?? '等待读取' }}
        </dd>
      </div>
      <div>
        <dt>码率</dt>
        <dd>{{ formatBitrate(props.item.technical?.bitrate) }}</dd>
      </div>
      <div>
        <dt>采样率</dt>
        <dd>
          {{
            props.item.technical?.sampleRate
              ? `${props.item.technical.sampleRate} Hz`
              : '未能读取'
          }}
        </dd>
      </div>
      <div>
        <dt>声道</dt>
        <dd>
          <IconStack2 :size="15" aria-hidden="true" />
          {{ props.item.technical?.channels ?? '未能读取' }}
        </dd>
      </div>
    </dl>

    <p v-if="props.item.technical?.lossless" class="inline-note">已探测为无损音频。</p>
    <p v-if="props.item.technical?.tagTypes.length" class="inline-note">
      标签来源：{{ props.item.technical.tagTypes.join('、') }}
    </p>
  </section>
</template>
