import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Phase L2: the shared profiles folder is never the user's real one in a test (PAGEMD_CONFIG_DIR moves it; empty here).
const PAGEMD_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'pagemd-test-config-'));

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.js'],
    environment: 'node',
    env: { PAGEMD_CONFIG_DIR }
  }
});
