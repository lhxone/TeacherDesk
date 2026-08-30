<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
// Tree-shaken imports: only the chart types this app renders. Importing the
// echarts barrel instead costs ~1MB in the bundle.
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const props = defineProps<{
  option: Record<string, unknown>;
  height?: string;
}>();

const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let observer: ResizeObserver | null = null;

function render() {
  if (!chart) return;
  // notMerge: option objects are rebuilt wholesale by the parent, so a merge
  // would leave stale series behind when a dataset shrinks.
  chart.setOption(props.option, true);
}

onMounted(() => {
  if (!el.value) return;
  chart = echarts.init(el.value);
  render();

  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(el.value);
});

watch(() => props.option, render, { deep: true });

onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
  chart = null;
});

defineExpose({
  toDataURL: () => chart?.getDataURL({ pixelRatio: 2, backgroundColor: '#fff' }) ?? '',
});
</script>

<template>
  <div ref="el" class="chart" :style="{ height: height ?? '300px' }" />
</template>
