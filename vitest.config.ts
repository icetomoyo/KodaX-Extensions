import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['extensions/**/tests/**/*.test.ts'],
    globals: false,
  },
});
