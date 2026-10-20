import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'plugins/*',
      'packages/*',
      {
        extends: false,
        test: {
          name: 'example-workflow',
          include: ['test/**/*.test.ts'],
          setupFiles: ['test/setup.ts'],
        },
      },
    ],
    passWithNoTests: true,
  },
});
