<script setup lang="ts">
import type { SurveyField } from '@/api/surveys';

withDefaults(defineProps<{ field: SurveyField; modelValue?: string; disabled?: boolean; preview?: boolean }>(), {
  modelValue: '', disabled: false, preview: false,
});
const emit = defineEmits<{ 'update:modelValue': [value: string]; file: [file: File | null, input: HTMLInputElement] }>();
function input(event: Event) { emit('update:modelValue', (event.target as HTMLInputElement).value); }
function fileInput(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('file', target.files?.[0] ?? null, target);
}
</script>

<template>
  <div class="field survey-control">
    <label :for="`${preview ? 'preview-' : 'answer-'}${field.id}`">
      {{ field.label || '未命名题目' }} <span v-if="field.required" class="required" aria-label="必填">*</span>
    </label>
    <textarea v-if="field.type === 'textarea'" :id="`${preview ? 'preview-' : 'answer-'}${field.id}`"
      class="textarea" :value="modelValue" :placeholder="field.placeholder || '请输入'" :required="field.required"
      :disabled="disabled" maxlength="10000" autocomplete="off" @input="input" />
    <select v-else-if="field.type === 'select'" :id="`${preview ? 'preview-' : 'answer-'}${field.id}`"
      class="select" :value="modelValue" :required="field.required" :disabled="disabled" autocomplete="off" @change="input">
      <option value="" disabled>{{ field.placeholder || '请选择' }}</option>
      <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
    </select>
    <template v-else-if="field.type === 'file'">
      <input :id="`${preview ? 'preview-' : 'answer-'}${field.id}`" class="input file-input" type="file"
        :required="field.required" :disabled="disabled" @change="fileInput" />
      <span class="hint">每题上传 1 个文件，最大 10 MB</span>
    </template>
    <input v-else :id="`${preview ? 'preview-' : 'answer-'}${field.id}`" class="input" :value="modelValue"
      :type="field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'"
      :inputmode="field.type === 'number' ? 'decimal' : field.type === 'phone' ? 'tel' : 'text'"
      :placeholder="field.placeholder || '请输入'" :required="field.required" :disabled="disabled"
      :maxlength="field.type === 'idcard' ? 18 : field.type === 'phone' ? 30 : 1000"
      :step="field.type === 'number' ? 'any' : undefined" autocomplete="off" @input="input" />
  </div>
</template>

<style scoped>
.survey-control > label { color: var(--text); font-size: 14px; overflow-wrap: anywhere; }
.required { color: var(--danger); margin-left: 3px; }
.file-input { font-size: 13px; }
.file-input::file-selector-button { border: 0; border-radius: 5px; background: var(--hover-tint); color: var(--text); padding: 5px 8px; margin-right: 10px; cursor: pointer; }
</style>
