<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/api/client';
import type { Envelope, StudentDetail } from '@/api/types';

const props = defineProps<{ studentId: string }>();

const student = ref<StudentDetail | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await api.get<Envelope<StudentDetail>>(`/students/${props.studentId}`);
    student.value = res.data;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <div v-if="loading" class="empty">加载中…</div>

    <template v-else-if="student">
      <header class="page-header">
        <div>
          <h1>{{ student.name }}</h1>
          <p class="hint">
            {{ student.className }}
            <template v-if="student.studentNo"> · 学号 {{ student.studentNo }}</template>
            <template v-if="student.gender">
              · {{ student.gender === 'male' ? '男' : student.gender === 'female' ? '女' : '其他' }}
            </template>
          </p>
        </div>
        <RouterLink class="btn btn-primary" :to="{ name: 'student-analytics', params: { studentId: student.id } }">
          查看成绩分析
        </RouterLink>
      </header>

      <div class="stack">
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-label">参考次数</div>
            <div class="stat-value">{{ student.stats.examCount }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">平均分</div>
            <div class="stat-value">{{ student.stats.avgScore ?? '—' }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">成绩波动</div>
            <div class="stat-value">{{ student.stats.stddev ?? '—' }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">被抽中次数</div>
            <div class="stat-value">{{ student.stats.lotteryCount }}</div>
          </div>
        </div>

        <section class="card">
          <div class="card-title">基本信息</div>
          <dl class="info">
            <dt>标签</dt>
            <dd>
              <span
                v-for="t in student.tags"
                :key="t.id"
                class="badge"
                :style="{ background: t.color + '22', color: t.color }"
              >{{ t.name }}</span>
              <span v-if="!student.tags.length" class="hint">无</span>
            </dd>

            <dt>家长联系电话</dt>
            <dd>{{ student.phone ?? '—' }}</dd>

            <dt>家长QQ</dt>
            <dd>{{ student.qq ?? '—' }}</dd>

            <dt>当前座位</dt>
            <dd>
              <template v-if="student.currentSeat">
                第 {{ student.currentSeat.rowIndex + 1 }} 行 第
                {{ student.currentSeat.colIndex + 1 }} 列
              </template>
              <span v-else class="hint">未排座</span>
            </dd>

            <dt>状态</dt>
            <dd>{{ student.status === 'active' ? '在读' : '非在读' }}</dd>
          </dl>
        </section>

        <section class="card">
          <div class="card-title">备注</div>
          <p v-if="student.note" class="note">{{ student.note }}</p>
          <p v-else class="hint">暂无备注</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.info {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 10px 16px;
  margin: 0;
}

.info dt { color: var(--text-muted); font-size: 13px; }
.info dd { margin: 0; }
.badge + .badge { margin-left: 4px; }
.note { white-space: pre-wrap; margin: 0; }

@media (max-width: 600px) {
  .info { grid-template-columns: 1fr; gap: 4px 0; }
  .info dd { margin-bottom: 8px; }
}
</style>
