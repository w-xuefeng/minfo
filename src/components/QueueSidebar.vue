<script setup lang="ts">
import { IconPlus, IconTrash } from '@tabler/icons-vue'

import type { QueueItem, QueueItemStatus } from '@/domain/model'

const props = defineProps<{
  items: readonly QueueItem[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  remove: [id: string]
  add: []
}>()

const statusText: Record<QueueItemStatus, string> = {
  queued: '等待读取',
  inspecting: '读取中',
  ready: '可编辑',
  'needs-action': '需要处理',
  processing: '导出中',
  succeeded: '已导出',
  failed: '失败',
  cancelled: '已取消',
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
</script>

<template>
  <aside class="queue-sidebar" aria-label="文件队列">
    <div class="queue-heading">
      <div>
        <p class="eyebrow">队列</p>
        <h2>{{ props.items.length }} 个文件</h2>
      </div>
      <button type="button" class="icon-button" aria-label="添加音频文件" @click="emit('add')">
        <IconPlus :size="20" aria-hidden="true" />
      </button>
    </div>

    <p v-if="props.items.length === 0" class="queue-empty">尚未加入文件</p>
    <ol v-else class="queue-list">
      <li v-for="item in props.items" :key="item.id">
        <div
          class="queue-item"
          :class="{ 'is-selected': item.id === props.selectedId }"
          :aria-current="item.id === props.selectedId ? 'true' : undefined"
        >
          <button type="button" class="queue-select" @click="emit('select', item.id)">
            <span class="queue-file-name">{{ item.identity.name }}</span>
            <span class="queue-meta">
              {{ formatBytes(item.identity.size) }} · {{ statusText[item.status] }}
            </span>
          </button>
          <button
            type="button"
            class="queue-remove"
            :aria-label="`从队列移除 ${item.identity.name}`"
            @click="emit('remove', item.id)"
          >
            <IconTrash :size="16" aria-hidden="true" />
          </button>
        </div>
      </li>
    </ol>
  </aside>
</template>
