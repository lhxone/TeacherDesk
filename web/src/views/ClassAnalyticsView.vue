<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '@/api/client';
import EChart from '@/components/EChart.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { ClassExamAnalytics, Envelope, Exam, Paged, TrendPoint } from '@/api/types';

const props = defineProps<{ classId: string }>();

const exams = ref<Exam[]>([]);
const selectedExamId = ref<string>('');
const analysis = ref<ClassExamAnalytics | null>(null);
const trend = ref<TrendPoint[]>([]);
const loading = ref(true);
const bucketSize = ref(10);

const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

const distributionOption = computed<Record<string, unknown>>(() => ({
  grid: { left: 48, right: 20, top: 30, bottom: 40 },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  xAxis: {
    type: 'category',
    data: analysis.value?.distribution.map((d) => d.range) ?? [],
    axisLabel: { fontSize: 11, rotate: 30 },
  },
  yAxis: { type: 'value', name: '人数', minInterval: 1 },
  series: [
    {
      type: 'bar',
      data: analysis.value?.distribution.map((d) => d.count) ?? [],
      itemStyle: { color: PALETTE[0], borderRadius: [4, 4, 0, 0] },
      barMaxWidth: 40,
    },
  ],
}));

const gradeOption = computed<Record<string, unknown>>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} 人 ({d}%)' },
  legend: { bottom: 0, itemWidth: 10, itemHeight: 10 },
  series: [
    {
      type: 'pie',
      radius: ['45%', '70%'],
      avoidLabelOverlap: true,
      label: { show: false },
      data:
        analysis.value?.gradeRatio
          .filter((g) => g.count > 0)
          .map((g, i) => ({
            name: g.label,
            value: g.count,
            itemStyle: { color: PALETTE[i % PALETTE.length] },
          })) ?? [],
    },
  ],
}));

const trendOption = computed<Record<string, unknown>>(() => ({
  grid: { left: 48, right: 24, top: 40, bottom: 50 },
  tooltip: { trigger: 'axis' },
  legend: { top: 0 },
  xAxis: {
    type: 'category',
    data: trend.value.map((t) => t.examName),
    axisLabel: { fontSize: 11, rotate: 20 },
  },
  yAxis: { type: 'value', name: '分数' },
  series: [
    {
      name: '均分',
      type: 'line',
      smooth: true,
      data: trend.value.map((t) => t.avg),
      itemStyle: { color: PALETTE[0] },
      lineStyle: { width: 3 },
    },
    {
      name: '最高分',
      type: 'line',
      smooth: true,
      data: trend.value.map((t) => t.max),
      itemStyle: { color: PALETTE[1] },
      lineStyle: { type: 'dashed' },
    },
    {
      name: '最低分',
      type: 'line',
      smooth: true,
      data: trend.value.map((t) => t.min),
      itemStyle: { color: PALETTE[3] },
      lineStyle: { type: 'dashed' },
    },
  ],
}));

async function loadExams() {
  const res = await api.get<Paged<Exam>>(`/classes/${props.classId}/exams`, { pageSize: 100 });
  exams.value = res.data;
  if (!selectedExamId.value && exams.value.length) selectedExamId.value = exams.value[0].id;
}

async function loadAnalysis() {
  if (!selectedExamId.value) {
    analysis.value = null;
    return;
  }
  const res = await api.get<Envelope<ClassExamAnalytics>>(
    `/analytics/class/${props.classId}/exam/${selectedExamId.value}`,
    { bucketSize: bucketSize.value },
  );
  analysis.value = res.data;
}

async function loadTrend() {
  const res = await api.get<Envelope<{ series: TrendPoint[] }>>(
    `/analytics/class/${props.classId}/trend`,
  );
  trend.value = res.data.series;
}

onMounted(async () => {
  loading.value = true;
  try {
    await loadExams();
    await Promise.all([loadAnalysis(), loadTrend()]);
  } finally {
    loading.value = false;
  }
});

watch([selectedExamId, bucketSize], loadAnalysis);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>班级成绩分析</h1>
      <div class="row">
        <select v-model="selectedExamId" class="select" style="width: auto">
          <option v-for="e in exams" :key="e.id" :value="e.id">
            {{ e.name }}（{{ e.examDate }}）
          </option>
        </select>
        <select v-model.number="bucketSize" class="select" style="width: auto">
          <option :value="10">10 分一档</option>
          <option :value="5">5 分一档</option>
        </select>
      </div>
    </header>

    <div v-if="loading" class="empty">加载中…</div>

    <EmptyState v-else-if="!exams.length" icon="chart" title="还没有考试数据">
      先在班级页创建考试并录入成绩，这里会自动生成图表
    </EmptyState>

    <div v-else class="stack">
      <div v-if="analysis" class="stat-grid">
        <div class="stat">
          <div class="stat-label">参考人数</div>
          <div class="stat-value">{{ analysis.summary.attended }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">均分</div>
          <div class="stat-value">{{ analysis.summary.avg ?? '—' }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">中位数</div>
          <div class="stat-value">{{ analysis.summary.median ?? '—' }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">最高 / 最低</div>
          <div class="stat-value">
            {{ analysis.summary.max ?? '—' }} / {{ analysis.summary.min ?? '—' }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">标准差</div>
          <div class="stat-value">{{ analysis.summary.stddev ?? '—' }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">及格率</div>
          <div class="stat-value">{{ pct(analysis.summary.passRate) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">优秀率</div>
          <div class="stat-value">{{ pct(analysis.summary.excellentRate) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">缺考</div>
          <div class="stat-value">{{ analysis.summary.absent }}</div>
        </div>
      </div>

      <EmptyState v-if="analysis?.summary.attended === 0" icon="exam" title="该场考试还没有录入成绩">
        录入后即可查看分布、等级与排名
      </EmptyState>

      <template v-else-if="analysis">
        <div class="two-col">
          <section class="card">
            <div class="card-title">分数分布</div>
            <EChart :option="distributionOption" height="280px" />
          </section>

          <section class="card">
            <div class="card-title">等级占比</div>
            <EChart :option="gradeOption" height="280px" />
          </section>
        </div>

        <section v-if="trend.length > 1" class="card">
          <div class="card-title">历次考试趋势</div>
          <EChart :option="trendOption" height="300px" />
        </section>

        <section class="card">
          <div class="card-title">成绩排名</div>
          <div class="table-wrap" style="border: none">
            <table>
              <thead>
                <tr>
                  <th>名次</th>
                  <th>学号</th>
                  <th>姓名</th>
                  <th>分数</th>
                  <th>较上次</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in analysis.ranking" :key="r.studentId">
                  <td>{{ r.rank }}</td>
                  <td>{{ r.studentNo ?? '—' }}</td>
                  <td>
                    <RouterLink :to="{ name: 'student-analytics', params: { studentId: r.studentId } }">
                      {{ r.studentName }}
                    </RouterLink>
                  </td>
                  <td>{{ r.score }}</td>
                  <td>
                    <span v-if="r.rankDelta == null" class="hint">—</span>
                    <span v-else-if="r.rankDelta > 0" class="up">↑ {{ r.rankDelta }}</span>
                    <span v-else-if="r.rankDelta < 0" class="down">↓ {{ -r.rankDelta }}</span>
                    <span v-else class="hint">持平</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
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
