<script setup lang="ts">
import { IconArrowsExchange, IconCode, IconForms } from '@tabler/icons-vue'

import type { RawTagConflict } from '@/application/metadata-diff'

const props = defineProps<{
  conflicts: readonly RawTagConflict[]
}>()

const emit = defineEmits<{
  resolve: [conflict: RawTagConflict, resolution: 'standard' | 'raw']
}>()
</script>

<template>
  <section
    v-if="props.conflicts.length"
    class="conflict-panel"
    aria-labelledby="conflict-heading"
  >
    <div class="conflict-heading">
      <IconArrowsExchange :size="20" aria-hidden="true" />
      <div>
        <p class="eyebrow">建议先整理</p>
        <h2 id="conflict-heading">标准字段与原始标签冲突</h2>
      </div>
    </div>
    <p>
      同一语义字段被编辑成不同值。你可以先为每项选定最终值；若选择直接导出，预检会说明副本中的相关槽位可能合并、重排或采用其中一个值，并要求确认。
    </p>
    <ol class="conflict-list">
      <li v-for="conflict in props.conflicts" :key="conflict.tagId">
        <div class="conflict-values">
          <div>
            <span class="conflict-label"
              ><IconForms :size="16" aria-hidden="true" />表单 {{ conflict.fieldLabel }}</span
            >
            <code>{{ conflict.standardValue || '（空值，表示删除）' }}</code>
          </div>
          <div>
            <span class="conflict-label"
              ><IconCode :size="16" aria-hidden="true" />原始 {{ conflict.tagKey }}</span
            >
            <code>{{ conflict.rawValue || '（空值，表示删除）' }}</code>
          </div>
        </div>
        <div class="conflict-actions">
          <button
            type="button"
            class="button button-secondary button-small"
            @click="emit('resolve', conflict, 'standard')"
          >
            保留表单值
          </button>
          <button
            type="button"
            class="button button-secondary button-small"
            @click="emit('resolve', conflict, 'raw')"
          >
            保留原始值
          </button>
        </div>
      </li>
    </ol>
  </section>
</template>
