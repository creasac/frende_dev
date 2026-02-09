import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      exclude: ['tests/components/**', 'tests/db/**'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'components',
      include: ['tests/components/**/*.test.tsx'],
      exclude: ['tests/unit/**', 'tests/db/**'],
      environment: 'happy-dom',
    },
  },
  {
    extends: './vitest.db.config.ts',
    test: {
      name: 'db',
      exclude: ['tests/unit/**', 'tests/components/**'],
    },
  },
])
