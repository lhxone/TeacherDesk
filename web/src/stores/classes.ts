import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api/client';
import type { ClassItem, Envelope, Paged } from '@/api/types';

export const useClassStore = defineStore('classes', () => {
  const items = ref<ClassItem[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  async function fetchAll(status: 'active' | 'archived' | 'all' = 'active') {
    loading.value = true;
    try {
      const res = await api.get<Paged<ClassItem>>('/classes', { status, pageSize: 100 });
      items.value = res.data;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  /** Load once per session unless a refresh is explicitly requested. */
  async function ensureLoaded() {
    if (!loaded.value) await fetchAll();
  }

  async function create(payload: Partial<ClassItem>) {
    const res = await api.post<Envelope<ClassItem>>('/classes', payload);
    items.value = [res.data, ...items.value];
    return res.data;
  }

  async function update(id: string, payload: Partial<ClassItem>) {
    const res = await api.patch<Envelope<ClassItem>>(`/classes/${id}`, payload);
    items.value = items.value.map((c) => (c.id === id ? res.data : c));
    return res.data;
  }

  async function remove(id: string) {
    await api.del(`/classes/${id}`);
    items.value = items.value.filter((c) => c.id !== id);
  }

  function byId(id: string) {
    return items.value.find((c) => c.id === id) ?? null;
  }

  /**
   * Setup stores get no automatic $reset(), so define one. Sign-in and sign-out
   * call this: without it, the previous teacher's class list stays in memory
   * and renders for the next account until a refetch replaces it.
   */
  function $reset() {
    items.value = [];
    loading.value = false;
    loaded.value = false;
  }

  return {
    items,
    loading,
    loaded,
    fetchAll,
    ensureLoaded,
    create,
    update,
    remove,
    byId,
    $reset,
  };
});
