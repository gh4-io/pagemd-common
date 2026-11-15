/**
 * Lint rule for @pagemd/theme-kit: the package must run in a browser (phase C5).
 * - imports no Node built-ins (fs, os, path, child_process, …) and no @pagemd/* package
 * - reads no process.*
 * And a smoke build: esbuild bundles it for platform "browser", and the bundle builds a document's
 * styles and page inside a bare VM context (no process, no require). Copied from @pagemd/meta's rule.
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
const ALLOWED_PAGEMD = new Set();
const IMPORT_RE = /(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\s)import\s*['"]([^'"]+)['"]/g;

/** Strip comments so documentation mentioning process.cwd() doesn't trip the rule */
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('@pagemd/theme-kit is browser-safe (lint rule)', () => {
  const files = listJs(srcRoot);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
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

describe('@pagemd/theme-kit bundles for the browser (smoke build)', () => {
  it('esbuild platform "browser" bundle resolves a document without Node globals or files', async () => {
    const result = await build({
      entryPoints: [join(srcRoot, 'index.js')],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'pagemdThemeKit',
      write: false,
      logLevel: 'silent'
    });
    expect(result.errors).toEqual([]);
    const code = result.outputFiles[0].text;

    const sandbox = { console, TextEncoder };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    expect(sandbox.process).toBeUndefined();
    expect(sandbox.require).toBeUndefined();

    const T = sandbox.pagemdThemeKit;
    const r = T.buildStyles({
      base: 'body{}',
      primary: 'p{}',
      layout: { content: '@page { size: A4; margin: 2cm }', path: '/d/layouts/x.css' },
      metadata: { running_header: 'H' },
      defaultsPath: '/d'
    });
    expect(r.page.width).toBe(210);
    expect(r.page.margins.left).toBe(20);
    expect(r.layout.bundled).toBe(true);
    expect(r.header.center).toBe('H');
  });
});
