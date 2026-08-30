import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Integration tests share one Postgres database, so they must not run
    // concurrently against each other.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
