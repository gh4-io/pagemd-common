/**
 * The markdown-it-multimd-table adapter (src/tables/multimd-table.js, phase U1).
 * markdown-it 15 removed `md.utils.assign`; the plugin (4.2.3) still calls it. The adapter puts it
 * back. The "still needed" test fails once an installed plugin release stops calling it (upstream
 * PR #83); then delete the adapter lines and this file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createDialect } from '../src/index.js';

const require = createRequire(import.meta.url);

describe('markdown-it-multimd-table adapter', () => {
  it('is still needed: the installed plugin calls md.utils.assign', () => {
    const source = readFileSync(require.resolve('markdown-it-multimd-table'), 'utf8');
    expect(source, 'upstream no longer calls md.utils.assign: remove the adapter').toContain('md.utils.assign');
  });

  it('lets the plugin load and read a multimd table (colspan)', () => {
    const md = createDialect();
    const html = md.render('| a | b |\n|---|---|\n| wide ||\n');
    expect(html).toContain('<td colspan="2">wide</td>');
  });
});
