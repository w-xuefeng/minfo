<script lang="ts">
export interface CreateSelectOption {
  readonly value: string
  readonly label?: string
  readonly disabled?: boolean
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: readonly CreateSelectOption[]
    allowCreate?: boolean
    /** Hides disabled options instead of showing them as unavailable. */
    filterDisabled?: boolean
    /** Lets the user narrow existing options before selecting one. */
    filterable?: boolean
    disabled?: boolean
    placeholder?: string
    ariaLabel?: string
    noResultsText?: string
  }>(),
  {
    allowCreate: false,
    filterDisabled: false,
    filterable: true,
    disabled: false,
    placeholder: '请选择',
    ariaLabel: '选择选项',
    noResultsText: '没有匹配的选项',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  select: [value: string]
  create: [value: string]
}>()

const instanceId = Math.random().toString(36).slice(2)
const root = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const query = ref(props.modelValue)
const activeIndex = ref(-1)

const listboxId = `create-select-options-${instanceId}`

const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase())
const isCurrentValueQuery = computed(() => query.value.trim() === props.modelValue)

const optionLabel = (option: CreateSelectOption): string => option.label ?? option.value

const filteredOptions = computed(() => {
  const visible = props.filterDisabled
    ? props.options.filter((option) => !option.disabled)
    : props.options
  if (!props.filterable || !normalizedQuery.value || isCurrentValueQuery.value) return visible
  return visible.filter((option) => {
    const haystack = `${option.value}\n${optionLabel(option)}`.toLocaleLowerCase()
    return haystack.includes(normalizedQuery.value)
  })
})

const knownOption = computed(() =>
  props.options.find(
    (option) =>
      option.value === query.value.trim() || optionLabel(option) === query.value.trim(),
  ),
)

const exactSelectableOption = computed(() => {
  const value = query.value.trim()
  return props.options.find(
    (option) => !option.disabled && (option.value === value || optionLabel(option) === value),
  )
})

const creatableValue = computed<string | null>(() => {
  const value = query.value.trim()
  if (!props.allowCreate || !value || knownOption.value) return null
  return value
})

const optionId = (index: number): string => `${listboxId}-option-${index}`

const resetActiveOption = (): void => {
  const selectedIndex = filteredOptions.value.findIndex(
    (option) => !option.disabled && option.value === props.modelValue,
  )
  activeIndex.value = selectedIndex >= 0 ? selectedIndex : -1
}

const open = (): void => {
  if (props.disabled) return
  const wasOpen = isOpen.value
  isOpen.value = true
  if (!wasOpen) resetActiveOption()
}

const close = (restoreQuery = true): void => {
  isOpen.value = false
  activeIndex.value = -1
  if (restoreQuery && !props.allowCreate) query.value = props.modelValue
}

const selectOption = (option: CreateSelectOption): void => {
  if (props.disabled || option.disabled) return
  query.value = option.value
  emit('update:modelValue', option.value)
  emit('select', option.value)
  close(false)
}

const createValue = (): void => {
  const value = creatableValue.value
  if (props.disabled || !value) return
  query.value = value
  emit('update:modelValue', value)
  emit('create', value)
  close(false)
}

const onInput = (event: Event): void => {
  query.value = (event.target as HTMLInputElement).value
  activeIndex.value = -1
  if (props.allowCreate) emit('update:modelValue', query.value)
  open()
}

const moveActiveOption = (direction: 1 | -1): void => {
  const selectableIndices = filteredOptions.value.flatMap((option, index) =>
    option.disabled ? [] : [index],
  )
  if (!selectableIndices.length) return

  const currentPosition = selectableIndices.indexOf(activeIndex.value)
  const nextPosition =
    currentPosition < 0
      ? direction === 1
        ? 0
        : selectableIndices.length - 1
      : (currentPosition + direction + selectableIndices.length) % selectableIndices.length
  activeIndex.value = selectableIndices[nextPosition] ?? -1
}

const onKeydown = (event: KeyboardEvent): void => {
  if (props.disabled) return
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      open()
      moveActiveOption(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      open()
      moveActiveOption(-1)
      break
    case 'Enter': {
      if (!isOpen.value) {
        open()
        return
      }
      event.preventDefault()
      const option = filteredOptions.value[activeIndex.value]
      if (option && !option.disabled) selectOption(option)
      else if (exactSelectableOption.value) selectOption(exactSelectableOption.value)
      else createValue()
      break
    }
    case 'Escape':
      if (isOpen.value) {
        event.preventDefault()
        close()
      }
      break
    case 'Tab':
      close()
      break
  }
}

const onFocusout = (event: FocusEvent): void => {
  const nextFocusTarget = event.relatedTarget
  if (nextFocusTarget instanceof Node && root.value?.contains(nextFocusTarget)) return
  close()
}

const toggle = (): void => {
  if (isOpen.value) close()
  else open()
}

watch(
  () => props.modelValue,
  (value) => {
    query.value = value
  },
)
</script>

<template>
  <div
    ref="root"
    class="create-select"
    :class="{ 'is-open': isOpen, 'is-disabled': props.disabled }"
    @focusout="onFocusout"
  >
    <div class="create-select-control">
      <input
        class="create-select-input"
        :value="query"
        :placeholder="props.placeholder"
        :disabled="props.disabled"
        :readonly="!props.filterable && !props.allowCreate"
        role="combobox"
        :aria-label="props.ariaLabel"
        aria-autocomplete="list"
        :aria-expanded="isOpen"
        :aria-controls="listboxId"
        :aria-activedescendant="isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined"
        @focus="open"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        class="create-select-toggle"
        type="button"
        :disabled="props.disabled"
        :aria-label="isOpen ? '收起选项' : '展开选项'"
        :aria-expanded="isOpen"
        @mousedown.prevent
        @click="toggle"
      >
        <span aria-hidden="true">⌄</span>
      </button>
    </div>

    <div
      v-if="isOpen"
      :id="listboxId"
      class="create-select-options"
      role="listbox"
      :aria-label="props.ariaLabel"
    >
      <button
        v-for="(option, index) in filteredOptions"
        :id="optionId(index)"
        :key="option.value"
        class="create-select-option"
        :class="{
          'is-active': index === activeIndex,
          'is-selected': option.value === props.modelValue,
          'is-disabled': option.disabled,
        }"
        type="button"
        role="option"
        :disabled="option.disabled"
        :aria-selected="option.value === props.modelValue"
        @mousedown.prevent
        @click="selectOption(option)"
      >
        {{ optionLabel(option) }}
      </button>

      <button
        v-if="creatableValue"
        class="create-select-option create-select-create-option"
        type="button"
        role="option"
        :aria-label="`创建 ${creatableValue}`"
        @mousedown.prevent
        @click="createValue"
      >
        创建“{{ creatableValue }}”
      </button>

      <p
        v-if="!filteredOptions.length && !creatableValue"
        class="create-select-empty"
        role="status"
      >
        {{ props.noResultsText }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.create-select {
  position: relative;
  min-width: 0;
}

.create-select-control {
  position: relative;
}

.create-select-input {
  padding-right: 42px;
}

.create-select-toggle {
  position: absolute;
  top: 50%;
  right: 5px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  transform: translateY(-50%);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
}

.create-select-toggle:hover:not(:disabled),
.create-select.is-open .create-select-toggle {
  background: var(--surface-muted);
  color: var(--accent);
}

.create-select-options {
  position: absolute;
  z-index: 4;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  display: grid;
  max-height: 232px;
  overflow: auto;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-small);
  background: var(--surface);
  box-shadow: var(--shadow);
  padding: 5px;
}

.create-select-option {
  width: 100%;
  border-radius: 6px;
  background: transparent;
  padding: 8px 10px;
  color: var(--text);
  text-align: left;
}

.create-select-option:hover:not(:disabled),
.create-select-option.is-active {
  background: var(--surface-muted);
  color: var(--accent);
}

.create-select-option.is-selected {
  font-weight: 680;
}

.create-select-option.is-disabled {
  color: var(--text-muted);
}

.create-select-create-option {
  border-top: 1px solid var(--line);
  margin-top: 4px;
  padding-top: 10px;
  color: var(--accent);
  font-weight: 650;
}

.create-select-empty {
  margin: 0;
  padding: 9px 10px;
  color: var(--text-muted);
  font-size: 0.84rem;
}
</style>
