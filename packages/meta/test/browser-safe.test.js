/**
 * Lint rule for @pagemd/meta: the package must run in a browser.
 * - imports no Node built-ins (fs, os, path, child_process, …) and no @pagemd/* package
 * - reads no process.*
 * And a smoke build: esbuild bundles it (catalogue.json included) for platform
 * "browser", and the bundle normalizes a frontmatter inside a bare VM context
 * (no process, no require). Copied from @pagemd/syntax's rule (phase C7).
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

describe('@pagemd/meta is browser-safe (lint rule)', () => {
  const files = listJs(srcRoot);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
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

describe('@pagemd/meta bundles for the browser (smoke build)', () => {
  it('esbuild platform "browser" bundle works without Node globals or files', async () => {
    const result = await build({
      entryPoints: [join(srcRoot, 'index.js')],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'pagemdMeta',
      write: false,
      logLevel: 'silent'
    });
    expect(result.errors).toEqual([]);
    const code = result.outputFiles[0].text;

    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    expect(sandbox.process).toBeUndefined();
    expect(sandbox.require).toBeUndefined();

    const meta = sandbox.pagemdMeta;
    const out = meta.normalizeMetadata({ 'Doc-ID': ' SOP-1 ', rev: '2', date: '2024-01-15', fancyLists: 'yes' });
    expect(out.document_id).toBe('SOP-1');
    expect(out.revision).toBe(2);
    expect(out.effective_date).toBe('01/15/2024');
    expect(out.fancy_lists).toBe(true);
    expect(out.status).toBe('Draft');
    expect(meta.catalogue().length).toBe(meta.CATALOGUE.fields.length);
    expect(meta.gateFor('fancy-lists')).toEqual({ field: 'fancy_lists', value: true });
  });
});
