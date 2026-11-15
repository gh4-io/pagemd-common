/**
 * Profiles and tokens: find, read (JSON/YAML), inherit, merge, cycles, validate, cache (phase C4).
 */

import { describe, it, expect } from 'vitest';
import {
  createMemoryFileSystem,
  createPathContext,
  expandTokens,
  loadProfileSync,
  loadAndMergeProfileSync,
  loadAndMergeProfile,
  mergeProfiles,
  validateProfile,
  getDefaultProfile,
  isProfilePath,
  profileSourcePath,
  detectCircularInheritanceGen,
  runPure
} from '../src/index.js';

const env = { homePath: '/home/u', cwd: '/work' };
const json = (o) => JSON.stringify(o);

function files() {
  return createMemoryFileSystem({
    '/cli/profiles/standard_letter.json': json({ id: 'standard_letter', a: { x: 1, y: 2 }, list: [1, 2] }),
    '/cli/profiles/child.yaml': 'id: child\nextends: standard_letter\na:\n  y: 3\nlist: [9]\nkeep: ~\n',
    '/cli/profiles/loop1.json': json({ id: 'loop1', extends: 'loop2' }),
    '/cli/profiles/loop2.json': json({ id: 'loop2', extends: 'loop1' }),
    '/cli/profiles/orphan.json': json({ id: 'orphan', extends: 'missing' }),
    '/cli/profiles/renamed.json': json({ id: 'other' }),
    '/cli/profiles/broken.json': '{ not json',
    '/work/my.json': json({ id: 'my' }),
    '/docs/local/p.yml': 'id: p\n'
  });
}

describe('tokens', () => {
  const ctx = createPathContext({ markdownDir: '/d', projectRoot: '/p', manifestDir: '/m', cliPath: '/cli' }, { env });

  it('the context has canonical and legacy names; home from the environment', () => {
    expect(ctx).toEqual({
      workingPath: '/d', workspacePath: '/p', manifestPath: '/m', homePath: '/home/u', cliPath: '/cli',
      markdownDir: '/d', projectRoot: '/p', manifestDir: '/m', workspaceFolder: '/p', configDir: null
    });
  });

  it('expands canonical and legacy tokens', () => {
    expect(expandTokens('${workingPath}|${workspacePath}|${manifestPath}|${homePath}|${cliPath}', ctx))
      .toBe('/d|/p|/m|/home/u|/cli');
    expect(expandTokens('${markdownDir}|${projectRoot}|${manifestDir}|${workspaceFolder}', ctx)).toBe('/d|/p|/m|/p');
    expect(expandTokens('', ctx)).toBe('');
  });

  it('a token without a value is an error, with the canonical name suggested for legacy ones', () => {
    const empty = createPathContext({}, {});
    expect(() => expandTokens('${cliPath}/x', empty)).toThrow('Token ${cliPath} used but not defined in context');
    expect(() => expandTokens('${projectRoot}/x', empty))
      .toThrow('Token ${projectRoot} used but not defined in context (consider using ${workspacePath} instead)');
  });
});

describe('loading one profile', () => {
  it('by name, with the 5-tier search; YAML and JSON; _manifestDir and the source path', () => {
    const fs = files();
    const p = loadProfileSync('child', { cliPath: '/cli' }, { fs, env });
    expect(p.id).toBe('child');
    expect(p._manifestDir).toBe('/cli/profiles');
    expect(profileSourcePath(p)).toBe('/cli/profiles/child.yaml');
  });

  it('an empty name loads the default profile (sync variant only)', () => {
    const fs = files();
    expect(getDefaultProfile()).toBe('standard_letter');
    expect(loadProfileSync('', { cliPath: '/cli' }, { fs, env }).id).toBe('standard_letter');
    expect(loadProfileSync('  ', { cliPath: '/cli' }, { fs, env }).id).toBe('standard_letter');
    expect(loadProfileSync(null, { cliPath: '/cli' }, { fs, env }).id).toBe('standard_letter');
  });

  it('not found → null; unreadable → an error', () => {
    const fs = files();
    expect(loadProfileSync('nope', { cliPath: '/cli' }, { fs, env })).toBeNull();
    expect(() => loadProfileSync('broken', { cliPath: '/cli' }, { fs, env })).toThrow(/^Failed to load profile broken: /);
  });

  it('an id different from the file name only warns (rendering never calls validateProfile)', () => {
    const warnings = [];
    const log = () => ({ trace() {}, debug() {}, info() {}, error() {}, warn: (...a) => warnings.push(a[2]) });
    const p = loadProfileSync('renamed', { cliPath: '/cli' }, { fs: files(), env, log });
    expect(p.id).toBe('other');
    expect(warnings).toContain('Profile ID does not match filename');
  });

  it('a path is read from the search folder (sync) or the working folder (async variant)', () => {
    const fs = files();
    expect(isProfilePath('local/p.yml')).toBe(true);
    expect(isProfilePath('plain')).toBe(false);
    expect(loadProfileSync('local/p', { searchFrom: '/docs' }, { fs, env }).id).toBe('p');
    expect(loadProfileSync('my.json', { searchFrom: '/docs', variant: 'async' }, { fs, env }).id).toBe('my');
    expect(loadProfileSync('local\\p.yml', { searchFrom: '/docs' }, { fs, env }).id).toBe('p');
    expect(loadProfileSync('local/none.json', { searchFrom: '/docs' }, { fs, env })).toBeNull();
  });

  it('the cache is shared: a second load reads nothing', () => {
    const fs = files();
    const cache = new Map();
    const a = loadProfileSync('child', { cliPath: '/cli' }, { fs, env, cache });
    const reads = fs.reads.length;
    const b = loadProfileSync('child', { cliPath: '/cli' }, { fs, env, cache });
    expect(b).toBe(a);
    expect(fs.reads.length).toBe(reads);
    expect(cache.has('profile:child:default:default:/cli')).toBe(true);
  });
});

describe('inheritance', () => {
  it('objects deep-merge, arrays are replaced, a null child value keeps the parent value', () => {
    const merged = mergeProfiles({ id: 'p', a: { x: 1, y: 2 }, list: [1], keep: 'yes' }, { id: 'c', a: { y: 3 }, list: [9], keep: null });
    expect(merged).toEqual({ id: 'c', a: { x: 1, y: 3 }, list: [9], keep: 'yes' });
  });

  it('loadAndMergeProfile follows extends (sync and async give the same)', async () => {
    const p = loadAndMergeProfileSync('child', { cliPath: '/cli' }, { fs: files(), env });
    expect(p).toMatchObject({ id: 'child', a: { x: 1, y: 3 }, list: [9], extends: 'standard_letter' });
    const q = await loadAndMergeProfile('child', { cliPath: '/cli' }, { fs: files().async(), env });
    expect(q).toEqual(p);
  });

  it('a cycle, a missing parent and a missing profile are errors', () => {
    expect(() => loadAndMergeProfileSync('loop1', { cliPath: '/cli' }, { fs: files(), env }))
      .toThrow('Circular inheritance detected: loop1 -> loop2 -> loop1');
    expect(() => loadAndMergeProfileSync('orphan', { cliPath: '/cli' }, { fs: files(), env }))
      .toThrow('Profile not found in inheritance chain: missing');
    expect(() => loadAndMergeProfileSync('nope', { cliPath: '/cli' }, { fs: files(), env }))
      .toThrow('Profile not found in inheritance chain: nope');
  });

  it('detectCircularInheritance works with any loader', () => {
    const table = { a: { extends: 'b' }, b: { extends: 'c' }, c: {} };
    // eslint-disable-next-line require-yield
    const loadGen = function* (name) { return table[name]; };
    expect(() => runPure(detectCircularInheritanceGen('a', [], loadGen))).not.toThrow();
    table.c.extends = 'a';
    expect(() => runPure(detectCircularInheritanceGen('a', [], loadGen))).toThrow('Circular inheritance detected: a -> b -> c -> a');
  });

  it('validateProfile: an id is required and must equal the file name', () => {
    expect(() => validateProfile({ id: 'x' }, 'x')).not.toThrow();
    expect(() => validateProfile({}, 'x')).toThrow("Profile missing required 'id' field");
    expect(() => validateProfile({ id: 'y' }, 'x'))
      .toThrow("Profile ID 'y' does not match filename 'x'. Profile ID must match filename exactly.");
  });
});
