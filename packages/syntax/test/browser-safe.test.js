/**
 * Lint rule for @pagemd/syntax: the package must run in a browser.
 * - imports no Node built-ins (fs, os, path, child_process, …) and no @pagemd/* package
 * - reads no process.*
 * And a smoke build: esbuild bundles it for platform "browser", and the bundle
 * renders a document inside a bare VM context (no process, no require).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(pkgRoot, 'src');

function listJs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listJs(full) : full.endsWith('.js') ? [full] : [];
  });
}

const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
// Also catches bare side-effect imports (`import 'path';`); fixed in phase C7
const IMPORT_RE = /(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\s)import\s*['"]([^'"]+)['"]/g;

/** Strip comments so documentation mentioning process.env doesn't trip the rule */
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('@pagemd/syntax is browser-safe (lint rule)', () => {
  const files = listJs(srcRoot);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const rel = relative(pkgRoot, file);
    const code = stripComments(readFileSync(file, 'utf8'));

    it(`${rel}: no Node built-ins or @pagemd/* imports`, () => {
      const specifiers = [...code.matchAll(IMPORT_RE)].map((m) => m[1] || m[2] || m[3] || m[4]);
      const bad = specifiers.filter((s) => NODE_BUILTINS.has(s) || s.startsWith('@pagemd/'));
      expect(bad).toEqual([]);
    });

    it(`${rel}: no process.*`, () => {
      expect(code).not.toMatch(/\bprocess\s*\.|\bprocess\s*\[/);
    });
  }
});

describe('@pagemd/syntax bundles for the browser (smoke build)', () => {
  it('esbuild platform "browser" bundle renders a document without Node globals', async () => {
    const result = await build({
      entryPoints: [join(srcRoot, 'index.js')],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'pagemdSyntax',
      write: false,
      logLevel: 'silent'
    });
    expect(result.errors).toEqual([]);
    const code = result.outputFiles[0].text;

    // Web-standard globals every browser has (markdown-it 15's build decodes a table with atob).
    const sandbox = { console, atob };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    expect(sandbox.process).toBeUndefined();
    expect(sandbox.require).toBeUndefined();

    const md = sandbox.pagemdSyntax.createDialect();
    const html = md.render([
      '[[WARNING]] Careful',
      '',
      '<!-- ::PAGEBREAK -->',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '::: note Title',
      'Body',
      ':::',
      '',
      '- [x] done[^1]',
      '',
      '[^1]: A note.'
    ].join('\n'));
    expect(html).toContain('callout callout-warning');
    expect(html).toContain('<div class="break-page"></div>');
    expect(html).toContain('<table>');
    expect(html).toContain('container container-note');
    // P26: markdown-it-footnote (ESM) and the task-list rule bundle too
    expect(html).toContain('<input class="task-list-item-checkbox" checked="" disabled="" type="checkbox"> done<sup class="footnote-ref">');
    expect(html).toContain('<li id="fn1" class="footnote-item"><p>A note.');
  });
});
