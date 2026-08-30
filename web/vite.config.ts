import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '教师工作台',
        short_name: 'TeacherDesk',
        description: '班级、学生、日程、座位、抽签分组与成绩分析一体化工作台',
        theme_color: '#3B82F6',
        background_color: '#F8FAFC',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // Auth endpoints must never be cached — a cached /auth/me would
            // hand the next visitor the previous teacher's identity.
            urlPattern: /\/api\/v1\/auth\//,
            handler: 'NetworkOnly',
          },
          {
            // Offline reads for PRD §3.8 / AC-16. These responses contain
            // student names, phone numbers and scores, so:
            //  - NetworkFirst, never StaleWhileRevalidate: a logged-in teacher
            //    must not be shown another account's data from cache while the
            //    network is available.
            //  - Short TTL, and purged on login/logout/auth-failure by
            //    purgeApiCaches().
            // The cache name must keep the `td-` prefix for that purge to find it.
            urlPattern: /\/api\/v1\/(classes|students|tags|schedule|events|seating-charts)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'td-data',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 12 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Analytics is derived data that is cheap to refetch and of little
            // use offline, so it is not worth persisting to disk at all.
            urlPattern: /\/api\/v1\/analytics\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
