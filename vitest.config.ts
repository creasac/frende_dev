import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/components/**/*.test.tsx'],
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/.next/**', '**/dist/**'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    environmentMatchGlobs: [['tests/components/**/*.test.tsx', 'happy-dom']],
  },
})
