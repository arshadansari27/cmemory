import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    exclude: [...configDefaults.exclude, '__tests__/integration/**'],
  },
});
