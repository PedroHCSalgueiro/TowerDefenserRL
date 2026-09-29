import { defineConfig } from 'vitest/config';

// `npm run bench`: medições de desempenho, fora do `npm test`.
export default defineConfig({
  test: {
    include: ['tests/**/*.perf.ts'],
    testTimeout: 120_000,
  },
});
