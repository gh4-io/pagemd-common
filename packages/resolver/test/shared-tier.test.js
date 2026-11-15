/**
 * Phase L2 (R-263, R-264): the shared profiles folder, its search tier (profiles only, after the project and before
 * ~/.pagemd), a match must be a file (F1: a profile pack's own folder made loading by name fail with ENOENT), and the
 * one listing of profiles with duplicates reported.
 */

import { describe, it, expect } from 'vitest';
import nodePath from 'node:path';
import {
  buildSearchPaths,
  createMemoryFileSystem,
  listProfilesSync,
  loadAndMergeProfileSync,
  loadProfileSync,
  profileListFolders,
  resolveResourceSync,
  sharedProfilesFolder,
  sharedProfilesFolderInfo
} from '../src/index.js';

const SHARED = '/data/pagemd/profiles';
const env = { homePath: '/home/u', cwd: '/proj', sharedProfilesPath: SHARED };

describe('sharedProfilesFolder: the rule for every system', () => {
  const none = () => false;
  it('Windows: %LOCALAPPDATA%\\pagemd\\profiles, else <home>\\AppData\\Local', () => {
    expect(sharedProfilesFolder({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local' }, homePath: 'C:\\Users\\Alice', path: nodePath.win32 }))
      .toBe('C:\\Users\\Alice\\AppData\\Local\\pagemd\\profiles');
    expect(sharedProfilesFolder({ platform: 'win32', env: {}, homePath: 'C:\\Users\\Alice', path: nodePath.win32 }))
      .toBe('C:\\Users\\Alice\\AppData\\Local\\pagemd\\profiles');
    // without path functions the Windows answer is still written with backslashes
    expect(sharedProfilesFolder({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local' }, homePath: 'C:\\Users\\Alice' }))
      .toBe('C:\\Users\\Alice\\AppData\\Local\\pagemd\\profiles');
  });
  it('macOS: ~/Library/Application Support/pagemd/profiles', () => {
    expect(sharedProfilesFolder({ platform: 'darwin', env: {}, homePath: '/Users/alice' })).toBe('/Users/alice/Library/Application Support/pagemd/profiles');
  });
  it('Linux: ${XDG_DATA_HOME:-~/.local/share}/pagemd/profiles', () => {
    expect(sharedProfilesFolder({ platform: 'linux', env: {}, homePath: '/home/bob', exists: none })).toBe('/home/bob/.local/share/pagemd/profiles');
    expect(sharedProfilesFolder({ platform: 'linux', env: { XDG_DATA_HOME: '/xdg' }, homePath: '/home/bob', exists: none })).toBe('/xdg/pagemd/profiles');
  });
  it('WSL: the Windows user named like the WSL user', () => {
    const exists = (p) => p === '/mnt/c/Users/alice/AppData/Local' || p === '/mnt/c/Users/Other/AppData/Local';
    const info = sharedProfilesFolderInfo({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu', USER: 'alice' }, homePath: '/home/alice', exists, list: () => ['alice', 'Other'] });
    expect(info).toEqual({ path: '/mnt/c/Users/alice/AppData/Local/pagemd/profiles', reason: 'wsl-user' });
  });
  it('WSL: else the only real Windows user (for example WSL bob, Windows Alice)', () => {
    const exists = (p) => p === '/mnt/c/Users/Alice/AppData/Local' || p === '/mnt/c/Users/Public/AppData/Local';
    const list = () => ['All Users', 'Default', 'Default User', 'desktop.ini', 'Alice', 'Public'];
    const info = sharedProfilesFolderInfo({ platform: 'linux', env: { USER: 'bob' }, homePath: '/home/bob', exists, list, osRelease: '6.6.87.2-microsoft-standard-WSL2' });
    expect(info).toEqual({ path: '/mnt/c/Users/Alice/AppData/Local/pagemd/profiles', reason: 'wsl-only-user' });
  });
  it('WSL with two real Windows users and no name match: the Linux folder', () => {
    const exists = (p) => /\/mnt\/c\/Users\/(A|B)\/AppData\/Local$/.test(p);
    expect(sharedProfilesFolderInfo({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu', USER: 'bob' }, homePath: '/home/bob', exists, list: () => ['A', 'B'] }))
      .toEqual({ path: '/home/bob/.local/share/pagemd/profiles', reason: 'xdg' });
  });
  it('PAGEMD_CONFIG_DIR replaces the folder on every system', () => {
    for (const platform of ['linux', 'darwin']) {
      expect(sharedProfilesFolderInfo({ platform, env: { PAGEMD_CONFIG_DIR: '/tmp/cfg', WSL_DISTRO_NAME: 'x' }, homePath: '/home/u', exists: () => true }))
        .toEqual({ path: '/tmp/cfg/profiles', reason: 'PAGEMD_CONFIG_DIR' });
    }
    expect(sharedProfilesFolder({ platform: 'win32', env: { PAGEMD_CONFIG_DIR: 'D:\\cfg', LOCALAPPDATA: 'C:\\x' }, homePath: 'C:\\Users\\J', path: nodePath.win32 })).toBe('D:\\cfg\\profiles');
    expect(sharedProfilesFolder({ platform: 'linux', env: { PAGEMD_CONFIG_DIR: '  ' }, homePath: '/home/u' })).toBe('/home/u/.local/share/pagemd/profiles');
  });
});

describe('buildSearchPaths: the shared tier', () => {
  const context = { workingPath: '/proj/docs', workspacePath: '/proj', cliPath: '/cli', sourceType: 'cli' };
  it('profiles: 6 tiers, the shared folder after the project and before ~/.pagemd', () => {
    expect(buildSearchPaths('profiles', context, { env })).toEqual([
      '/proj/docs', '/proj/docs/profiles', '/proj/docs/.pagemd/profiles',
      '/proj', '/proj/profiles', '/proj/.pagemd/profiles',
      SHARED,
      '/home/u/.pagemd/profiles',
      '/cli/profiles'
    ]);
  });
  it('other types keep their 5 tiers (no shared folder)', () => {
    for (const type of ['templates', 'layouts', 'styles']) {
      expect(buildSearchPaths(type, context, { env })).not.toContain(SHARED);
    }
  });
  it('no shared folder in the ports: the list is the same as before L2', () => {
    const { sharedProfilesPath, ...before } = env;
    expect(buildSearchPaths('profiles', context, { env: before })).not.toContain(SHARED);
    expect(buildSearchPaths('profiles', context, { env: before })).toHaveLength(8);
  });
});

/** A pack as the library unpacks it: `<name>.json` next to the folder `<name>/` with the manifest and files. */
const pack = (folder, name, version = '0.1.0') => ({
  [`${folder}/${name}.json`]: JSON.stringify({ id: name, description: `pack ${name}`, resources: { css: [`./${name}/style.css`] } }),
  [`${folder}/${name}/manifest.json`]: JSON.stringify({ id: name, version, built: '2026-11-01', pagemdMinVersion: null, requires: 'R-259', files: [] }),
  [`${folder}/${name}/style.css`]: 'p{}'
});

describe('F1 fixed: a profile pack is found by name', () => {
  it('<shared>/sop.json next to <shared>/sop/ loads by name', () => {
    const fs = createMemoryFileSystem({ ...pack(SHARED, 'sop'), '/proj/package.json': '{}' });
    const profile = loadProfileSync('sop', { searchFrom: '/proj', configDir: '/proj', cliPath: '/cli' }, { fs, env });
    expect(profile).toMatchObject({ id: 'sop', _manifestDir: SHARED });
    expect(resolveResourceSync('sop', 'profiles', { workingPath: '/proj', cliPath: '/cli' }, { fs, env }).resolvedPath).toBe(`${SHARED}/sop.json`);
  });
  it('the same in ~/.pagemd/profiles (the folder was taken for the profile there too)', () => {
    const fs = createMemoryFileSystem(pack('/home/u/.pagemd/profiles', 'sop'));
    expect(loadProfileSync('sop', { searchFrom: '/proj' }, { fs, env: { homePath: '/home/u' } })).toMatchObject({ id: 'sop' });
  });
  it('a folder named like a profile, with no profile file, is not a match', () => {
    const fs = createMemoryFileSystem({ [`${SHARED}/sop/manifest.json`]: '{}' });
    expect(() => resolveResourceSync('sop', 'profiles', { workingPath: '/proj' }, { fs, env })).toThrow(/Resource not found: sop/);
  });
  it('every type: a folder named like a stylesheet is skipped', () => {
    const fs = createMemoryFileSystem({ '/proj/styles/report.css/readme.txt': 'x', '/home/u/.pagemd/styles/report.css': 'p{}' });
    expect(resolveResourceSync('report.css', 'styles', { workingPath: '/proj' }, { fs, env }).resolvedPath).toBe('/home/u/.pagemd/styles/report.css');
  });
  it('a FileSystem port without stat() still works (exists, as before L2)', () => {
    const mem = createMemoryFileSystem({ '/proj/profiles/a.json': '{"id":"a"}' });
    const fs = { exists: mem.exists, readText: mem.readText, list: mem.list };
    expect(resolveResourceSync('a', 'profiles', { workingPath: '/proj' }, { fs, env: { path: nodePath.posix } }).resolvedPath).toBe('/proj/profiles/a.json');
  });
});

describe('duplicates stay an error (R-264)', () => {
  it('the same name in the shared folder and ~/.pagemd: Duplicate resources found', () => {
    const fs = createMemoryFileSystem({ ...pack(SHARED, 'sop'), '/home/u/.pagemd/profiles/sop.json': '{"id":"sop"}' });
    expect(() => resolveResourceSync('sop', 'profiles', { workingPath: '/proj' }, { fs, env })).toThrow(/Duplicate resources found for "sop"/);
    expect(() => loadAndMergeProfileSync('sop', { searchFrom: '/proj' }, { fs, env })).toThrow(/Duplicate/);
  });
  it('the same name in the project and the shared folder: also an error', () => {
    const fs = createMemoryFileSystem({ ...pack(SHARED, 'sop'), '/proj/profiles/sop.yaml': 'id: sop' });
    expect(() => resolveResourceSync('sop', 'profiles', { workingPath: '/proj' }, { fs, env })).toThrow(/Duplicate/);
  });
});

describe('listProfiles: one listing, duplicates reported', () => {
  const files = {
    '/proj/package.json': '{}',
    '/proj/docs/a.md': '# a',
    '/proj/docs/profiles/near.json': '{"id":"near"}',
    '/proj/profiles/mine.json': '{"id":"mine","description":"project profile"}',
    '/proj/.pagemd/profiles/ws.yaml': 'id: ws',
    ...pack(SHARED, 'pml-sop-ink', '0.1.0'),
    [`${SHARED}/.pml-x.installing`]: '{}',
    [`${SHARED}/notes.txt`]: 'not a profile',
    '/home/u/.pagemd/profiles/pml-sop-ink.json': '{"id":"pml-sop-ink","description":"Installed by pagemd-library"}',
    '/home/u/.pagemd/profiles/old.json': '{"id":"old"}',
    '/cli/profiles/standard_letter.json': '{"id":"standard_letter","description":"bundled"}'
  };
  it('lists every tier, with the pack version, and reports a name found twice', () => {
    const fs = createMemoryFileSystem(files);
    const list = listProfilesSync({ documentPath: '/proj/docs/a.md', cliPath: '/cli' }, { fs, env });
    expect(list.map((e) => [e.name, e.tier])).toEqual([
      ['mine', 'project'],
      ['near', 'document'],
      ['old', 'home'],
      ['pml-sop-ink', 'shared'],
      ['pml-sop-ink', 'home'],
      ['standard_letter', 'pagemd'],
      ['ws', 'workspace']
    ]);
    const shared = list.find((e) => e.tier === 'shared');
    expect(shared).toMatchObject({ version: '0.1.0', pack: { version: '0.1.0', built: '2026-11-01', pagemdMinVersion: null, requires: 'R-259' }, description: 'pack pml-sop-ink' });
    expect(shared.duplicates).toEqual(['/home/u/.pagemd/profiles/pml-sop-ink.json']);
    expect(list.find((e) => e.name === 'mine').duplicates).toEqual([]);
  });
  it('the folders, in the search order; a document in the project root lists its folders once', () => {
    expect(profileListFolders({ documentDir: '/proj', projectRoot: '/proj', cliPath: '/cli' }, { env }).map((f) => f.tier))
      .toEqual(['project', 'workspace', 'shared', 'home', 'pagemd']);
  });
  it('the engine agrees: a name listed twice does not build', () => {
    const fs = createMemoryFileSystem(files);
    expect(() => loadAndMergeProfileSync('pml-sop-ink', { searchFrom: '/proj/docs', configDir: '/proj', cliPath: '/cli' }, { fs, env })).toThrow(/Duplicate/);
    expect(loadAndMergeProfileSync('mine', { searchFrom: '/proj/docs', configDir: '/proj', cliPath: '/cli' }, { fs, env })).toMatchObject({ id: 'mine' });
  });
});
