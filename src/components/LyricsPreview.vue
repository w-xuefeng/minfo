<script setup lang="ts">
import { computed } from 'vue'
import { IconChevronDown, IconClock, IconTextCaption } from '@tabler/icons-vue'

import { parseLyricsPreview } from '@/domain/lrc'
import type { LyricsSlot } from '@/domain/model'

const props = defineProps<{
  lyricsSlot: LyricsSlot
}>()

const preview = computed(() => parseLyricsPreview(props.lyricsSlot.text))
</script>

<template>
  <details class="lyrics-preview" :aria-label="`${props.lyricsSlot.language} 歌词预览`">
    <summary class="lyrics-preview-heading" aria-label="切换歌词预览">
      <span class="field-label">歌词预览</span>
      <span class="lyrics-preview-toggle" aria-hidden="true">
        <span v-if="preview.mode === 'timed'" class="lyrics-preview-summary">LRC 时间轴</span>
        <span v-else-if="preview.mode === 'mixed'" class="lyrics-preview-summary"
          >混合歌词</span
        >
        <span v-else class="lyrics-preview-summary">原文预览</span>
        <span class="lyrics-preview-closed-label">展开</span>
        <span class="lyrics-preview-open-label">收起</span>
        <IconChevronDown :size="16" />
      </span>
    </summary>

    <div class="lyrics-preview-content" aria-live="polite">
      <div class="lyrics-preview-slot-heading">
        <strong>{{ props.lyricsSlot.language }}</strong>
        <span v-if="preview.mode === 'timed'" class="status-label">
          <IconClock :size="15" aria-hidden="true" />
          检测到 LRC 时间标签
        </span>
        <span v-else-if="preview.mode === 'mixed'" class="status-label">
          <IconClock :size="15" aria-hidden="true" />
          时间标签与普通文本混合
        </span>
        <span v-else class="status-label">
          <IconTextCaption :size="15" aria-hidden="true" />
          纯文本歌词
        </span>
      </div>

      <div v-if="!props.lyricsSlot.text" class="lyrics-empty">这个槽位尚未填写歌词。</div>
      <template v-else-if="preview.mode === 'plain'">
        <p v-for="(line, index) in preview.plainLines" :key="index" class="lyrics-plain-line">
          {{ line || '' }}
        </p>
      </template>
      <template v-else>
        <ol class="lyrics-timeline">
          <li v-for="event in preview.events" :key="`${event.line}-${event.milliseconds}`">
            <time :datetime="`PT${event.milliseconds / 1000}S`">{{ event.timeLabel }}</time>
            <span>{{ event.text || '' }}</span>
          </li>
        </ol>
        <div v-if="preview.unmarkedLines.length" class="lyrics-unmarked">
          <p class="field-label">未标记内容</p>
          <p v-for="(line, index) in preview.unmarkedLines" :key="index">{{ line }}</p>
        </div>
      </template>
      <p v-if="preview.mode !== 'plain'" class="inline-note">
        时间轴只优化阅读体验。浏览器会把 LRC 原文作为普通歌词写入，不生成或验证 SYLT。
      </p>
    </div>
  </details>
</template>
