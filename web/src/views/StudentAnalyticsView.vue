<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '@/api/client';
import EChart from '@/components/EChart.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Envelope, StudentAnalytics } from '@/api/types';

const props = defineProps<{ studentId: string }>();

const data = ref<StudentAnalytics | null>(null);
const loading = ref(true);

const PALETTE = ['#3B82F6', '#94A3B8', '#10B981'];

const scoreOption = computed<Record<string, unknown>>(() => ({
  grid: { left: 48, right: 24, top: 40, bottom: 50 },
  tooltip: { trigger: 'axis' },
  legend: { top: 0 },
  xAxis: {
    type: 'category',
    data: data.value?.trend.map((t) => t.examName) ?? [],
    axisLabel: { fontSize: 11, rotate: 20 },
  },
  yAxis: { type: 'value', name: '分数' },
  series: [
    {
      name: '个人成绩',
      type: 'line',
      smooth: true,
      symbolSize: 8,
      data: data.value?.trend.map((t) => t.score) ?? [],
      itemStyle: { color: PALETTE[0] },
      lineStyle: { width: 3 },
    },
    {
      name: '班级均分',
      type: 'line',
      smooth: true,
      data: data.value?.trend.map((t) => t.classAvg) ?? [],
      itemStyle: { color: PALETTE[1] },
      lineStyle: { type: 'dashed' },
    },
  ],
}));

// Rank axis is inverted so first place sits at the top, which is how a
// teacher reads a rank chart.
const rankOption = computed<Record<string, unknown>>(() => ({
  grid: { left: 48, right: 24, top: 30, bottom: 50 },
  tooltip: { trigger: 'axis', formatter: (p: unknown) => {
    const arr = p as { name: string; value: number }[];
    return `${arr[0].name}<br/>第 ${arr[0].value} 名`;
  } },
  xAxis: {
    type: 'category',
    data: data.value?.trend.map((t) => t.examName) ?? [],
    axisLabel: { fontSize: 11, rotate: 20 },
  },
  yAxis: { type: 'value', name: '名次', inverse: true, minInterval: 1, min: 1 },
  series: [
    {
      type: 'line',
      smooth: true,
      symbolSize: 8,
      data: data.value?.trend.map((t) => t.rank) ?? [],
      itemStyle: { color: PALETTE[2] },
      lineStyle: { width: 3 },
    },
  ],
}));

const radarOption = computed<Record<string, unknown>>(() => {
  const radar = data.value?.subjectRadar ?? [];
  return {
    tooltip: {},
    radar: {
      indicator: radar.map((r) => ({ name: r.subject, max: 3, min: -3 })),
      radius: '65%',
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            // Z-scores make different subjects and full scores comparable.
            value: radar.map((r) => r.zScore),
            name: '标准分 (Z-score)',
            areaStyle: { color: 'rgba(59,130,246,0.22)' },
            lineStyle: { color: PALETTE[0] },
            itemStyle: { color: PALETTE[0] },
          },
        ],
      },
    ],
  };
});

onMounted(async () => {
  try {
    const res = await api.get<Envelope<StudentAnalytics>>(`/analytics/student/${props.studentId}`);
    data.value = res.data;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <div v-if="loading" class="empty">加载中…</div>

    <template v-else-if="data">
      <header class="page-header">
        <div>
          <h1>{{ data.student.name }} 的成绩分析</h1>
          <p class="hint">
            {{ data.student.className }}
            <template v-if="data.student.studentNo"> · 学号 {{ data.student.studentNo }}</template>
          </p>
        </div>
        <RouterLink class="btn" :to="{ name: 'student-detail', params: { studentId: data.student.id } }">
          学生档案
        </RouterLink>
      </header>

      <EmptyState v-if="!data.trend.length" icon="trend" title="该学生还没有成绩记录">
        录入任意一场考试成绩后，这里会显示趋势与名次变化
      </EmptyState>

      <div v-else class="stack">
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-label">参考次数</div>
            <div class="stat-value">{{ data.summary.examCount }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">平均分</div>
            <div class="stat-value">{{ data.summary.avgScore ?? '—' }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">最好 / 最差</div>
            <div class="stat-value">
              {{ data.summary.bestScore ?? '—' }} / {{ data.summary.worstScore ?? '—' }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">平均名次</div>
            <div class="stat-value">{{ data.summary.avgRank ?? '—' }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">最好名次</div>
            <div class="stat-value">{{ data.summary.bestRank ?? '—' }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">稳定性（标准差）</div>
            <div class="stat-value">{{ data.summary.stddev ?? '—' }}</div>
          </div>
        </div>

        <section class="card">
          <div class="card-title">成绩趋势（对比班级均分）</div>
          <EChart :option="scoreOption" height="300px" />
        </section>

        <div class="two-col">
          <section class="card">
            <div class="card-title">名次变化</div>
            <EChart :option="rankOption" height="280px" />
          </section>

          <section v-if="data.subjectRadar.length >= 3" class="card">
            <div class="card-title">各科标准分雷达</div>
            <EChart :option="radarOption" height="280px" />
          </section>

          <section v-else class="card">
            <div class="card-title">各科表现</div>
            <div class="table-wrap" style="border: none">
              <table>
                <thead>
                  <tr><th>科目</th><th>分数</th><th>班级均分</th><th>标准分</th></tr>
                </thead>
                <tbody>
                  <tr v-for="r in data.subjectRadar" :key="r.subject">
                    <td>{{ r.subject }}</td>
                    <td>{{ r.score }}</td>
                    <td>{{ r.classAvg ?? '—' }}</td>
                    <td :class="r.zScore >= 0 ? 'up' : 'down'">
                      {{ r.zScore > 0 ? '+' : '' }}{{ r.zScore }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="hint" style="margin-top: 8px">科目达到 3 门以上时显示雷达图</p>
          </section>
        </div>

        <section class="card">
          <div class="card-title">历次成绩明细</div>
          <div class="table-wrap" style="border: none">
            <table>
              <thead>
                <tr>
                  <th>考试</th><th>日期</th><th>科目</th><th>分数</th>
                  <th>班级均分</th><th>名次</th><th>标准分</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in data.trend" :key="t.examId">
                  <td>{{ t.examName }}</td>
                  <td>{{ t.examDate }}</td>
                  <td>{{ t.subject ?? '—' }}</td>
                  <td><strong>{{ t.score }}</strong></td>
                  <td>{{ t.classAvg ?? '—' }}</td>
                  <td>{{ t.rank }} / {{ t.totalStudents }}</td>
                  <td :class="t.zScore >= 0 ? 'up' : 'down'">
                    {{ t.zScore > 0 ? '+' : '' }}{{ t.zScore }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.two-col {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr 1fr;
}

@media (max-width: 900px) {
  .two-col { grid-template-columns: 1fr; }
}
</style>
