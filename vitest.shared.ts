// Settings every plugin and package project shares; each project's vitest.config.ts spreads it.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export const shared = {
  test: { setupFiles: [resolve(root, 'test/setup.ts')] },
};
