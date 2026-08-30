<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
</script>

<template>
  <div class="page">
    <EmptyState icon="compass" title="页面不存在">
      你访问的页面可能已被移除，或者地址有误
      <div style="margin-top: 14px">
        <RouterLink class="btn btn-primary" :to="{ name: 'home' }">返回首页</RouterLink>
      </div>
    </EmptyState>
  </div>
</template>
