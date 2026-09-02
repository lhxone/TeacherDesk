<script setup lang="ts">
import { ref } from 'vue';
import { ApiError } from '@/api/client';
import { resourcesApi } from '@/api/resources';
import type { KnowledgeNode, ResourceCollection, ResourceType, Tag } from '@/api/types';
import { RESOURCE_TYPE_LABELS } from '@/api/types';
import ModalDialog from '@/components/ModalDialog.vue';

const props = defineProps<{
  collections: ResourceCollection[];
  tags: Tag[];
  knowledgeNodes: KnowledgeNode[];
}>();
const emit = defineEmits<{ close: []; uploaded: [] }>();

const file = ref<File | null>(null);
const title = ref('');
const type = ref<ResourceType | ''>('');
const subject = ref('');
const grade = ref('');
const selectedTagIds = ref<string[]>([]);
const selectedKnowledgeNodeIds = ref<string[]>([]);
const uploading = ref(false);
const error = ref('');

const TYPE_OPTIONS: ResourceType[] = ['textbook', 'ppt', 'lesson_plan', 'image', 'mistake', 'document', 'other'];

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
  if (file.value && !title.value) {
    title.value = file.value.name.replace(/\.[^.]+$/, '');
  }
}

function toggleTag(id: string) {
  selectedTagIds.value = selectedTagIds.value.includes(id)
    ? selectedTagIds.value.filter((x) => x !== id)
    : [...selectedTagIds.value, id];
}

function toggleKnowledgeNode(id: string) {
  selectedKnowledgeNodeIds.value = selectedKnowledgeNodeIds.value.includes(id)
    ? selectedKnowledgeNodeIds.value.filter((x) => x !== id)
    : [...selectedKnowledgeNodeIds.value, id];
}

async function submit() {
  if (!file.value) {
    error.value = '请选择要上传的文件';
    return;
  }
  error.value = '';
  uploading.value = true;
  try {
    await resourcesApi.upload(file.value, {
      title: title.value.trim() || undefined,
      type: type.value || undefined,
      subject: subject.value.trim() || undefined,
      grade: grade.value.trim() || undefined,
      tagIds: selectedTagIds.value,
      knowledgeNodeIds: selectedKnowledgeNodeIds.value,
    });
    emit('uploaded');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '上传失败';
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <ModalDialog title="上传教学资源" @close="emit('close')">
    <form class="stack" @submit.prevent="submit">
      <div class="field">
        <label>文件</label>
        <input type="file" class="input" @change="onFileChange" />
        <p class="hint">支持 PPT / Word / PDF / 图片等，上传后会自动在后台解析正文内容</p>
      </div>
      <div class="field">
        <label>标题</label>
        <input v-model="title" class="input" placeholder="留空则使用文件名" />
      </div>
      <div class="field">
        <label>类型</label>
        <select v-model="type" class="select">
          <option value="">自动识别</option>
          <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ RESOURCE_TYPE_LABELS[t] }}</option>
        </select>
      </div>
      <div class="row">
        <div class="field" style="flex: 1">
          <label>学科</label>
          <input v-model="subject" class="input" placeholder="如：数学" />
        </div>
        <div class="field" style="flex: 1">
          <label>年级</label>
          <input v-model="grade" class="input" placeholder="如：七年级" />
        </div>
      </div>

      <div v-if="tags.length" class="field">
        <label>标签</label>
        <div class="row">
          <button
            v-for="t in tags"
            :key="t.id"
            type="button"
            class="badge tag-toggle"
            :class="{ picked: selectedTagIds.includes(t.id) }"
            :style="{ background: t.color + '22', color: t.color }"
            @click="toggleTag(t.id)"
          >
            {{ t.name }}
          </button>
        </div>
      </div>

      <div v-if="knowledgeNodes.length" class="field">
        <label>知识点</label>
        <div class="row">
          <button
            v-for="n in knowledgeNodes"
            :key="n.id"
            type="button"
            class="badge tag-toggle"
            :class="{ picked: selectedKnowledgeNodeIds.includes(n.id) }"
            @click="toggleKnowledgeNode(n.id)"
          >
            {{ n.name }}
          </button>
        </div>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>
    </form>

    <template #footer>
      <button class="btn" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="uploading" @click="submit">
        {{ uploading ? '上传中…' : '上传' }}
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.tag-toggle { border: 1px solid transparent; opacity: 0.55; }
.tag-toggle.picked { opacity: 1; border-color: currentColor; }
</style>
