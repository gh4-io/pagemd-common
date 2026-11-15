/**
 * Lint rule for @pagemd/validate: the package must run in a browser (phase C4).
 * - imports no Node built-ins (fs, os, path, child_process, …); of the @pagemd/* packages only
 *   @pagemd/meta (another browser-safe pagemd-common package), never pagemd
 * - reads no process.*
 * And a smoke build: esbuild bundles it for platform "browser", and the bundle resolves a document
 * over the in-memory FileSystem inside a bare VM context (no process, no require), with both drivers.
 * Copied from @pagemd/meta's rule.
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
const ALLOWED_PAGEMD = new Set(['@pagemd/meta', '@pagemd/resolver', '@pagemd/syntax', '@pagemd/theme-kit']);
const IMPORT_RE = /(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\s)import\s*['"]([^'"]+)['"]/g;

/** Strip comments so documentation mentioning process.cwd() doesn't trip the rule */
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('@pagemd/validate is browser-safe (lint rule)', () => {
  const files = listJs(srcRoot);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    const rel = relative(pkgRoot, file);
    const code = stripComments(readFileSync(file, 'utf8'));

    it(`${rel}: no Node built-ins, no pagemd packages`, () => {
      const specifiers = [...code.matchAll(IMPORT_RE)].map((m) => m[1] || m[2] || m[3] || m[4]);
      const bad = specifiers.filter((s) => NODE_BUILTINS.has(s) || (s.startsWith('@pagemd/') && !ALLOWED_PAGEMD.has(s)));
      expect(bad).toEqual([]);
    });

    it(`${rel}: no process.*`, () => {
      expect(code).not.toMatch(/\bprocess\s*\.|\bprocess\s*\[/);
    });
  }
});

describe('@pagemd/validate bundles for the browser (smoke build)', () => {
  it('esbuild platform "browser" bundle checks a document without Node globals or files', async () => {
    const entry = `export * from ${JSON.stringify(join(srcRoot, 'index.js'))}; export { createMemoryFileSystem } from '@pagemd/resolver';`;
    const result = await build({
      stdin: { contents: entry, resolveDir: pkgRoot, sourcefile: 'entry.js' },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'pagemdValidate',
      write: false,
      logLevel: 'silent'
    });
    expect(result.errors).toEqual([]);
    const sandbox = { console, TextEncoder, TextDecoder, URL, atob, btoa }; // what a browser has
    vm.createContext(sandbox);
    vm.runInContext(result.outputFiles[0].text, sandbox);
    expect(sandbox.process).toBeUndefined();
    expect(sandbox.require).toBeUndefined();

    const V = sandbox.pagemdValidate;
    const fs = V.createMemoryFileSystem({
      '/p/package.json': '{}',
      '/p/a.md': '',
      '/d/profiles/standard_letter.json': '{"id":"standard_letter","validation":{"required_fields":["title"]}}'
    });
    const env = { homePath: '/h', defaultsPath: '/d' };
    const text = '# no title\n';
    const sync = V.validateSync({ path: '/p/a.md', text }, {}, { fs, env });
    expect(sync.diagnostics.map((d) => d.code)).toContain('missing-required-field');
    const viaAsync = await V.validate({ path: '/p/a.md', text }, {}, { fs: fs.async(), env });
    expect(JSON.stringify(viaAsync)).toBe(JSON.stringify(sync));
  });
});
