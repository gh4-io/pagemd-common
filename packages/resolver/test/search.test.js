/**
 * The 5-tier search and the two other lookups (phase C4, R-24: the code's behaviour is the spec).
 * An in-memory FileSystem places one file in each tier.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSearchPaths,
  resolveResourceSync,
  resolveResource,
  resolveResourcePathSync,
  resolvePath,
  findResourceWithDuplicateCheckSync,
  createMemoryFileSystem,
  createPathContext
} from '../src/index.js';

const env = { homePath: '/home/u', cwd: '/work' };
const context = {
  workingPath: '/proj/docs',
  manifestPath: '/profiles/mine',
  workspacePath: '/proj',
  cliPath: '/cli',
  sourceType: 'profile'
};

describe('buildSearchPaths: the order is locked (R-24)', () => {
  it('layouts: document → profile → workspace (./, ./{type}/, ./.pagemd/{type}/) → ~/.pagemd → bundled', () => {
    expect(buildSearchPaths('layouts', context, { env })).toEqual([
      '/proj/docs',
      '/proj/docs/layouts',
      '/proj/docs/.pagemd/layouts',
      '/profiles/mine',
      '/profiles/mine/layouts',
      '/profiles/mine/.pagemd/layouts',
      '/proj',
      '/proj/layouts',
      '/proj/.pagemd/layouts',
      '/home/u/.pagemd/layouts',
      '/cli/layouts'
    ]);
  });

  it('styles add presets/ syntax/ vendor/ under {type}/ and .pagemd/{type}/ in every tier', () => {
    const paths = buildSearchPaths('styles', { ...context, sourceType: 'frontmatter' }, { env });
    expect(paths).toEqual([
      '/proj/docs', '/proj/docs/styles', '/proj/docs/.pagemd/styles',
      '/proj/docs/styles/presets', '/proj/docs/.pagemd/styles/presets',
      '/proj/docs/styles/syntax', '/proj/docs/.pagemd/styles/syntax',
      '/proj/docs/styles/vendor', '/proj/docs/.pagemd/styles/vendor',
      '/proj', '/proj/styles', '/proj/.pagemd/styles',
      '/proj/styles/presets', '/proj/.pagemd/styles/presets',
      '/proj/styles/syntax', '/proj/.pagemd/styles/syntax',
      '/proj/styles/vendor', '/proj/.pagemd/styles/vendor',
      '/home/u/.pagemd/styles', '/home/u/.pagemd/styles/presets',
      '/home/u/.pagemd/styles/syntax', '/home/u/.pagemd/styles/vendor',
      '/cli/styles', '/cli/styles/presets', '/cli/styles/syntax', '/cli/styles/vendor'
    ]);
  });

  it('the profile folder is searched only for paths that came from a profile', () => {
    for (const sourceType of ['frontmatter', 'cli', undefined]) {
      expect(buildSearchPaths('layouts', { ...context, sourceType }, { env })).not.toContain('/profiles/mine');
    }
  });

  it('a folder listed twice is searched once (document folder = workspace)', () => {
    const paths = buildSearchPaths('templates', { workingPath: '/p', workspacePath: '/p', cliPath: '/cli' }, { env });
    expect(paths).toEqual(['/p', '/p/templates', '/p/.pagemd/templates', '/home/u/.pagemd/templates', '/cli/templates']);
  });

  it("the context's homePath wins over the environment's", () => {
    const paths = buildSearchPaths('layouts', { homePath: '/h2' }, { env });
    expect(paths).toEqual(['/h2/.pagemd/layouts']);
  });
});

describe('resolveResource: every tier is found', () => {
  const tiers = {
    'tier 1, document folder': '/proj/docs/.pagemd/layouts/x.css',
    'tier 2, profile folder': '/profiles/mine/layouts/x.css',
    'tier 3, workspace': '/proj/x.css',
    'tier 4, home': '/home/u/.pagemd/layouts/x.css',
    'tier 5, bundled': '/cli/layouts/x.css'
  };
  for (const [name, file] of Object.entries(tiers)) {
    it(name, async () => {
      const fs = createMemoryFileSystem({ [file]: '' });
      expect(resolveResourceSync('x.css', 'layouts', context, { fs, env }).resolvedPath).toBe(file);
      expect((await resolveResource('x.css', 'layouts', context, { fs: fs.async(), env })).resolvedPath).toBe(file);
    });
  }

  it('a name found in two tiers is an error, not "the first wins"', () => {
    const fs = createMemoryFileSystem({ '/proj/docs/x.css': '', '/cli/layouts/x.css': '' });
    let error;
    try {
      resolveResourceSync('x.css', 'layouts', context, { fs, env });
    } catch (err) {
      error = err;
    }
    expect(error.message).toBe(
      'Duplicate resources found for "x.css":\n  1. /proj/docs/x.css\n  2. /cli/layouts/x.css\n\n' +
      'Please use unique names or specify an absolute path.'
    );
    expect(error.duplicates).toEqual(['/proj/docs/x.css', '/cli/layouts/x.css']);
  });

  it('a name without an extension also matches the type extensions (one per folder)', () => {
    const fs = createMemoryFileSystem({ '/cli/profiles/p.yaml': '', '/cli/profiles/p.yml': '' });
    expect(resolveResourceSync('p', 'profiles', { cliPath: '/cli' }, { fs, env }).resolvedPath).toBe('/cli/profiles/p.yaml');
    const fs2 = createMemoryFileSystem({ '/cli/templates/t.htm': '' });
    expect(resolveResourceSync('t', 'templates', { cliPath: '/cli' }, { fs: fs2, env }).resolvedPath).toBe('/cli/templates/t.htm');
  });

  it('not found: every searched folder in the message and on the error', () => {
    const fs = createMemoryFileSystem({});
    let error;
    try {
      resolveResourceSync('none.css', 'layouts', { workingPath: '/d', cliPath: '/cli' }, { fs, env });
    } catch (err) {
      error = err;
    }
    expect(error.message).toBe(
      'Resource not found: none.css\nSearched in:\n  1. /d\n  2. /d/layouts\n  3. /d/.pagemd/layouts\n' +
      '  4. /home/u/.pagemd/layouts\n  5. /cli/layouts'
    );
    expect(error.searchedPaths).toHaveLength(5);
  });

  it('absolute paths are used as they are (no search)', () => {
    const fs = createMemoryFileSystem({ '/abs/a.css': '', '/proj/docs/a.css': '' });
    expect(resolveResourceSync('/abs/a.css', 'styles', context, { fs, env })).toEqual({ resolvedPath: '/abs/a.css', searchedPaths: [] });
    expect(() => resolveResourceSync('/abs/b.css', 'styles', context, { fs, env })).toThrow('Absolute path not found: /abs/b.css');
  });

  it('./ and ../ resolve from the profile folder, else the document, else the workspace (no search)', () => {
    const fs = createMemoryFileSystem({ '/profiles/mine/a.css': '', '/proj/docs/b.css': '', '/proj/c.css': '' });
    expect(resolveResourceSync('./a.css', 'styles', context, { fs, env }).resolvedPath).toBe('/profiles/mine/a.css');
    expect(resolveResourceSync('./b.css', 'styles', { ...context, manifestPath: null }, { fs, env }).resolvedPath).toBe('/proj/docs/b.css');
    expect(resolveResourceSync('./c.css', 'styles', { workspacePath: '/proj' }, { fs, env }).resolvedPath).toBe('/proj/c.css');
    expect(() => resolveResourceSync('./zz.css', 'styles', context, { fs, env }))
      .toThrow('Relative path not found: ./zz.css (resolved to /profiles/mine/zz.css)');
    expect(() => resolveResourceSync('./a.css', 'styles', {}, { fs, env }))
      .toThrow('No base directory available for relative path resolution');
  });

  it('findResourceWithDuplicateCheck reports matches per folder', () => {
    const fs = createMemoryFileSystem({ '/a/x.css': '', '/b/x.css': '' });
    expect(findResourceWithDuplicateCheckSync('x.css', ['/a'], 'styles', { fs, env })).toEqual({ found: '/a/x.css', duplicates: [] });
    expect(findResourceWithDuplicateCheckSync('x.css', ['/a', '/b'], 'styles', { fs, env }))
      .toEqual({ found: null, duplicates: ['/a/x.css', '/b/x.css'] });
    expect(findResourceWithDuplicateCheckSync('x.css', ['/c'], 'styles', { fs, env })).toEqual({ found: null, duplicates: [] });
  });
});

describe('lookup 2: resolveResourcePath (document → config → project root, first wins)', () => {
  const ctx = createPathContext({ markdownDir: '/d', configDir: '/c', projectRoot: '/p' }, { env });

  it('the first folder that has the file wins (no duplicate error)', () => {
    const fs = createMemoryFileSystem({ '/c/f.woff': '', '/p/f.woff': '' });
    expect(resolveResourcePathSync('f.woff', ctx, { fs, env })).toBe('/c/f.woff');
  });

  it('not found: the three candidates', () => {
    const fs = createMemoryFileSystem({});
    let error;
    try {
      resolveResourcePathSync('f.woff', ctx, { fs, env });
    } catch (err) {
      error = err;
    }
    expect(error.message).toBe('Resource not found: f.woff');
    expect(error.searchedPaths).toEqual(['/d/f.woff', '/c/f.woff', '/p/f.woff']);
    expect(() => resolveResourcePathSync('f', {}, { fs, env })).toThrow('No search directories available in context');
  });
});

describe('lookup 3: resolvePath (no search; OQ-10 compares it with the render search in C8)', () => {
  it('a relative path joins the project root, else the config folder, else the document folder', () => {
    expect(resolvePath('a/b.css', { projectRoot: '/p', configDir: '/c', markdownDir: '/d' }, { env })).toBe('/p/a/b.css');
    expect(resolvePath('a/b.css', { configDir: '/c', markdownDir: '/d' }, { env })).toBe('/c/a/b.css');
    expect(resolvePath('a/b.css', { markdownDir: '/d' }, { env })).toBe('/d/a/b.css');
  });

  it('it never looks at files, even when the file sits in another tier', () => {
    const fs = createMemoryFileSystem({ '/home/u/.pagemd/layouts/l.css': '' });
    expect(resolvePath('l.css', { projectRoot: '/p' }, { fs, env })).toBe('/p/l.css');
  });

  it('tokens are expanded; absolute results normalized; errors', () => {
    expect(resolvePath('${cliPath}//x/../y.css', { cliPath: '/cli' }, { env })).toBe('/cli/y.css');
    expect(() => resolvePath('', {}, { env })).toThrow('Cannot resolve empty path');
    expect(() => resolvePath('x', {}, { env })).toThrow('No base directory available in context for path resolution');
  });
});
