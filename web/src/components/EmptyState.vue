<script setup lang="ts">
/**
 * Empty-state placeholder with a line-art SVG icon.
 *
 * Replaces the emoji these states used to show: emoji render differently on
 * every OS (the Windows coffee cup in particular is heavy and off-palette),
 * ignore the theme colour, and scale unpredictably. These icons inherit
 * currentColor and use a consistent 1.5px stroke.
 */
type IconName =
  | 'calendar'
  | 'classes'
  | 'students'
  | 'exam'
  | 'chart'
  | 'trend'
  | 'seating'
  | 'compass'
  | 'search';

withDefaults(
  defineProps<{
    icon: IconName;
    title?: string;
  }>(),
  { title: '' },
);
</script>

<template>
  <div class="empty">
    <div class="empty-art" aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- Soft disc behind every glyph so the icons read as one family. -->
        <circle cx="32" cy="32" r="30" class="disc" />

        <g
          class="glyph"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <!-- A free day: an empty calendar page -->
          <template v-if="icon === 'calendar'">
            <rect x="18" y="20" width="28" height="26" rx="3" />
            <path d="M18 28h28" />
            <path d="M26 16v6M38 16v6" />
            <path d="M26 36h5" class="accent" />
          </template>

          <!-- Classes: stacked books -->
          <template v-else-if="icon === 'classes'">
            <path d="M20 22h11a3 3 0 0 1 3 3v19a3 3 0 0 0-3-3H20z" />
            <path d="M44 22H33a3 3 0 0 0-3 3v19a3 3 0 0 1 3-3h11z" />
            <path d="M32 25v19" class="accent" />
          </template>

          <!-- Students: a small group -->
          <template v-else-if="icon === 'students'">
            <circle cx="26" cy="26" r="6" />
            <path d="M16 45c0-5.5 4.5-10 10-10s10 4.5 10 10" />
            <circle cx="42" cy="29" r="5" class="accent" />
            <path d="M38 45c0-4.4 3.1-8 7-8 2.6 0 4.9 1.6 6.1 4" class="accent" />
          </template>

          <!-- Exams: a marked paper -->
          <template v-else-if="icon === 'exam'">
            <path d="M22 16h14l8 8v24a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2V18a2 2 0 0 1 2-2z" />
            <path d="M36 16v8h8" />
            <path d="M26 32h12M26 38h8" />
            <path d="M26 44h4" class="accent" />
          </template>

          <!-- Analytics: bars on an axis -->
          <template v-else-if="icon === 'chart'">
            <path d="M18 46h28" />
            <path d="M18 46V20" />
            <rect x="24" y="34" width="6" height="12" rx="1" />
            <rect x="33" y="26" width="6" height="20" rx="1" class="accent" />
            <rect x="42" y="38" width="6" height="8" rx="1" />
          </template>

          <!-- Personal trend: a rising line -->
          <template v-else-if="icon === 'trend'">
            <path d="M18 46h28" />
            <path d="M18 46V20" />
            <path d="M23 40l7-7 6 5 9-11" class="accent" />
            <circle cx="45" cy="27" r="2.5" class="accent" />
          </template>

          <!-- Seating: a grid of desks -->
          <template v-else-if="icon === 'seating'">
            <rect x="18" y="18" width="10" height="8" rx="2" />
            <rect x="36" y="18" width="10" height="8" rx="2" />
            <rect x="18" y="32" width="10" height="8" rx="2" class="accent" />
            <rect x="36" y="32" width="10" height="8" rx="2" />
            <path d="M22 46h20" />
          </template>

          <!-- Search returned nothing -->
          <template v-else-if="icon === 'search'">
            <circle cx="29" cy="29" r="10" />
            <path d="M37 37l9 9" class="accent" />
          </template>

          <!-- Lost: a compass -->
          <template v-else>
            <circle cx="32" cy="32" r="14" />
            <path d="M38 26l-4 10-10 4 4-10z" class="accent" />
          </template>
        </g>
      </svg>
    </div>

    <p v-if="title" class="empty-title">{{ title }}</p>
    <div class="empty-body"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
}

.empty-art {
  width: 88px;
  height: 88px;
  margin: 0 auto 14px;
  color: var(--brand);
}

.empty-art svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* Very light tint so the icon has presence without competing with content. */
.disc {
  fill: var(--brand-soft);
}

.glyph {
  opacity: 0.55;
}

/* One or two strokes per icon at full strength, to give it a focal point. */
.glyph .accent {
  opacity: 1;
  stroke: var(--brand);
}

.empty-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.empty-body {
  font-size: 13px;
  line-height: 1.7;
}

.empty-body :deep(a) {
  font-weight: 500;
}
</style>
