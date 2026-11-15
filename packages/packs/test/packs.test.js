/**
 * @pagemd/packs (phase L2-4, L2-5, L2-10). The fixtures are real packs made by pagemd-library (commit e1c91e0,
 * `node scripts/pack.mjs pml-sop-ink uofo-sop --out … --built 2026-11-01`; uofo-sop is the library's fictional company pack; `library-v2/` is pml-sop-ink built by the library's
 * `buildPack` as version 0.2.0). Every bad pack the library's `check-packs.mjs --self-test` makes is made here from a
 * fixture with this package's writer, which gives the library's bytes (first test), and must be refused.
 * Every install goes into a temporary folder; PAGEMD_CONFIG_DIR points at one too, so the real shared folder and
 * ~/.pagemd are never touched.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolveResourceSync } from '@pagemd/resolver';
import {
  EXIT,
  PackError,
  compareVersions,
  crc32Fallback,
  defaultTarget,
  defaultTargetInfo,
  incomplete,
  installPack,
  latestPacks,
  listInstalled,
  otherProfileFolders,
  parseIndex,
  readIndexFile,
  readZip,
  sha256,
  uninstallPack,
  verifyPack,
  writeZip
} from '../src/index.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const LIB = path.join(FIXTURES, 'library');
const ink = fs.readFileSync(path.join(LIB, 'pml-sop-ink-0.1.0.zip'));
const uofo = fs.readFileSync(path.join(LIB, 'uofo-sop-0.1.0.zip'));
const inkV2 = fs.readFileSync(path.join(FIXTURES, 'library-v2', 'pml-sop-ink-0.2.0.zip'));
const id = 'pml-sop-ink';

const temps = [];
const tmp = (p = 'x') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `pagemd-packs-${p}-`));
  temps.push(d);
  return d;
};
const savedConfigDir = process.env.PAGEMD_CONFIG_DIR;
beforeAll(() => { process.env.PAGEMD_CONFIG_DIR = tmp('config'); });
afterAll(() => {
  if (savedConfigDir === undefined) delete process.env.PAGEMD_CONFIG_DIR; else process.env.PAGEMD_CONFIG_DIR = savedConfigDir;
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});

const good = () => readZip(ink).filter((e) => !e.isDir).map(({ name, data }) => ({ name, data }));
/** A zip of `list` with a manifest that agrees with it (as the library's self-test makes them). */
const withManifest = (list) => {
  const body = list.filter((f) => f.name !== `${id}/manifest.json`);
  const m = JSON.parse(good().find((f) => f.name === `${id}/manifest.json`).data.toString());
  m.files = body.map((f) => ({ path: f.name, size: f.data.length, sha256: sha256(f.data) }));
  return writeZip([...body, { name: `${id}/manifest.json`, data: Buffer.from(JSON.stringify(m, null, 2)) }]);
};
const refusal = (buf, sha = sha256(buf)) => {
  try {
    verifyPack(buf, sha);
  } catch (e) {
    expect(e).toBeInstanceOf(PackError);
    return e;
  }
  return null;
};
/** Is `name` findable as a profile in `folder`? (the resolver's own search, the shared tier only) */
const findable = (name, folder) => {
  const nodeFs = {
    exists: (p) => fs.existsSync(p),
    readText: (p) => fs.readFileSync(p, 'utf8'),
    stat: (p) => { try { const s = fs.statSync(p); return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size }; } catch { return null; } },
    list: (p) => fs.readdirSync(p)
  };
  try {
    return resolveResourceSync(name, 'profiles', {}, { fs: nodeFs, env: { path, sharedProfilesPath: folder } }).resolvedPath;
  } catch {
    return null;
  }
};

describe('the same as the library', () => {
  it("the writer gives the library's bytes (so the bad packs below are what the library would make)", () => {
    for (const zip of [ink, uofo, inkV2]) {
      const entries = readZip(zip).filter((e) => !e.isDir).map(({ name, data }) => ({ name, data }));
      expect(writeZip(entries).equals(zip)).toBe(true);
    }
  });
  it('the small CRC-32 gives zlib.crc32 (for a Node without it)', () => {
    for (const e of readZip(uofo)) expect(crc32Fallback(e.data)).toBe(zlib.crc32(e.data) >>> 0);
  });
  it('the fixtures are accepted with the checksums in their index', () => {
    const index = readIndexFile(path.join(LIB, 'index.json'));
    for (const entry of index.packs) {
      const pack = verifyPack(fs.readFileSync(path.join(LIB, entry.file)), entry.sha256);
      expect(pack.id).toBe(entry.id);
      expect(incomplete(pack.id, pack.files)).toEqual([]);
    }
  });
});

describe("refused: every bad pack of the library's self-test, nothing written", () => {
  const files = good();
  const tpl = files.find((f) => f.name.endsWith('.html'));
  const cases = [
    ['a tampered checksum (index says something else)', () => refusal(ink, '0'.repeat(64)), /does not match its checksum/],
    ['a zip with a changed byte (checksum of the original)', () => { const b = Buffer.from(ink); b[Math.floor(b.length / 2)] ^= 0xff; return refusal(b, sha256(ink)); }, /does not match its checksum/],
    ['a zip-slip entry ../evil.css', () => refusal(withManifest([...files, { name: '../evil.css', data: Buffer.from('a{}') }])), /escapes|outside/],
    ['a zip-slip entry deep inside', () => refusal(withManifest([...files, { name: `${id}/../../evil.css`, data: Buffer.from('a{}') }])), /escapes/],
    ['an absolute path', () => refusal(withManifest([...files, { name: '/etc/evil.css', data: Buffer.from('a{}') }])), /absolute/],
    ['a Windows drive path', () => refusal(withManifest([...files, { name: 'C:/evil.css', data: Buffer.from('a{}') }])), /absolute/],
    ['a backslash path', () => refusal(withManifest([...files, { name: `${id}\\..\\evil.css`, data: Buffer.from('a{}') }])), /backslash/],
    ['a script file (.js)', () => refusal(withManifest([...files, { name: `${id}/run.js`, data: Buffer.from('alert(1)') }])), /not allowed/],
    ['an executable (.exe)', () => refusal(withManifest([...files, { name: `${id}/a.exe`, data: Buffer.from('MZ') }])), /not allowed/],
    ['a <script> inside the template (manifest kept consistent)', () => refusal(withManifest(files.map((f) => (f === tpl ? { ...f, data: Buffer.from(f.data.toString().replace('</body>', '<script>alert(1)</script></body>')) } : f)))), /<script>/],
    ['an on...= handler in an SVG', () => refusal(withManifest([...files, { name: `${id}/a.svg`, data: Buffer.from('<svg onload="x()"></svg>') }])), /event attribute/],
    ['a remote url() in CSS', () => refusal(withManifest(files.map((f) => (f.name.endsWith('tokens.css') ? { ...f, data: Buffer.from(`${f.data}\na{background:url(https://evil.example/x.png)}`) } : f)))), /remote url|outside the pack/],
    ['@import in CSS', () => refusal(withManifest(files.map((f) => (f.name.endsWith('tokens.css') ? { ...f, data: Buffer.from(`@import "x.css";\n${f.data}`) } : f)))), /@import/],
    ['a font that is not a font', () => refusal(withManifest(files.map((f) => (f.name.endsWith('Inter-Bold.woff2') ? { ...f, data: Buffer.from('not a font') } : f)))), /not a real/],
    ['a missing font (manifest kept consistent)', () => refusal(withManifest(files.filter((f) => !f.name.endsWith('Inter-Bold.woff2')))), /not self-contained.*Inter-Bold/],
    ['a missing stylesheet the profile names', () => refusal(withManifest(files.filter((f) => !f.name.endsWith('theme.css')))), /not self-contained/],
    ['a changed file with the old manifest', () => refusal(writeZip(files.map((f) => (f.name.endsWith('document.css') ? { ...f, data: Buffer.from(`${f.data}\n/* x */`) } : f)))), /manifest/],
    ['a file the manifest does not list', () => refusal(writeZip([...files, { name: `${id}/extra.css`, data: Buffer.from('a{}') }])), /not listed in the manifest/],
    ['a file the manifest lists but the zip lacks', () => { const m = JSON.parse(files.find((f) => f.name === `${id}/manifest.json`).data); m.files.push({ path: `${id}/gone.css`, size: 1, sha256: '0' }); return refusal(writeZip(files.map((f) => (f.name === `${id}/manifest.json` ? { ...f, data: Buffer.from(JSON.stringify(m)) } : f)))); }, /lists .*gone\.css/],
    ['a name twice (case ignored)', () => refusal(withManifest([...files, { name: `${id}/Core/Tokens.css`, data: Buffer.from('a{}') }, { name: `${id}/core/tokens.CSS`, data: Buffer.from('b{}') }])), /appears twice/],
    ['an entry outside <id>.json and <id>/', () => refusal(withManifest([...files, { name: 'other/a.css', data: Buffer.from('a{}') }])), /outside/],
    ['a symbolic link entry', () => { const link = Buffer.from(ink); const cd = link.readUInt32LE(link.length - 22 + 16); link.writeUInt32LE(((0o120777 << 16) >>> 0), cd + 38); return refusal(link); }, /symbolic link/],
    ['not a zip', () => refusal(Buffer.from('hello, this is not a zip file at all')), /not a zip/]
  ];
  for (const [what, make, re] of cases) {
    it(what, () => {
      const e = make();
      expect(e, 'it was not refused').not.toBeNull();
      expect(e.message).toMatch(re);
      expect(e.code).toBe(EXIT.refused);
    });
  }
  it('no checksum at all is a usage error (2), never skipped', () => {
    expect(refusal(ink, '').code).toBe(EXIT.usage);
    expect(() => verifyPack(ink, undefined)).toThrow(expect.objectContaining({ code: EXIT.usage }));
  });
});

describe('installing', () => {
  it('installs a pack that pagemd then finds by name, profile last', () => {
    const t = tmp('install');
    const written = [];
    const r = installPack(verifyPack(ink, sha256(ink)), t, { onWrite: (name) => written.push(name) });
    expect(r).toMatchObject({ id, version: '0.1.0', written: 22, unchanged: 0, removed: 0 });
    expect(written.at(-1)).toBe(`${id}.json`);
    expect(written.at(-2)).toBe(`${id}/manifest.json`);
    expect(findable(id, t)).toBe(path.join(t, `${id}.json`));
    expect(fs.existsSync(path.join(t, `.${id}.installing`))).toBe(false);
    // again: nothing to do
    expect(installPack(verifyPack(ink, sha256(ink)), t)).toMatchObject({ written: 0, unchanged: 22 });
  });
  it('--dry-run writes nothing', () => {
    const t = tmp('dry');
    expect(installPack(verifyPack(ink, sha256(ink)), t, { dryRun: true })).toMatchObject({ written: 22 });
    expect(fs.readdirSync(t)).toEqual([]);
  });
  it('a file it did not write stops the install (exit 3), nothing written', () => {
    const t = tmp('foreign');
    fs.mkdirSync(path.join(t, id), { recursive: true });
    fs.writeFileSync(path.join(t, `${id}.json`), '{"mine":true}\n');
    let e = null;
    try { installPack(verifyPack(ink, sha256(ink)), t); } catch (err) { e = err; }
    expect(e?.code).toBe(EXIT.wouldOverwrite);
    expect(fs.readFileSync(path.join(t, `${id}.json`), 'utf8')).toBe('{"mine":true}\n');
    expect(fs.existsSync(path.join(t, id, 'manifest.json'))).toBe(false);
  });
  it('an update over its own unchanged files works; a hand-edited file stops it (exit 3)', () => {
    const t = tmp('upgrade');
    installPack(verifyPack(ink, sha256(ink)), t);
    expect(installPack(verifyPack(inkV2, sha256(inkV2)), t)).toMatchObject({ version: '0.2.0' });
    expect(listInstalled(t)[0]).toMatchObject({ id, version: '0.2.0', changed: [] });
    fs.appendFileSync(path.join(t, id, 'core', 'document.css'), '\n/* edited by hand */');
    let e = null;
    try { installPack(verifyPack(ink, sha256(ink)), t); } catch (err) { e = err; }
    expect(e?.code).toBe(EXIT.wouldOverwrite);
    expect(e.message).toMatch(/core\/document\.css/);
  });
  it('an update removes the files the old version had and the new one does not (only when unchanged)', () => {
    const t = tmp('stale');
    const files = good();
    const extra = withManifest([...files, { name: `${id}/notes.txt`, data: Buffer.from('old notes') }]);
    installPack(verifyPack(extra, sha256(extra)), t);
    expect(fs.existsSync(path.join(t, id, 'notes.txt'))).toBe(true);
    expect(installPack(verifyPack(ink, sha256(ink)), t)).toMatchObject({ removed: 1 });
    expect(fs.existsSync(path.join(t, id, 'notes.txt'))).toBe(false);
  });
});

describe('an install that stops half-way (L2-5 a, b)', () => {
  const stopAfter = (n) => (name, i) => { if (i >= n) throw new Error(`stopped before ${name}`); };
  for (const n of [0, 5, 20, 21]) {
    it(`stopped after ${n} file(s): nothing findable; the retry finishes`, () => {
      const t = tmp(`stop${n}`);
      expect(() => installPack(verifyPack(ink, sha256(ink)), t, { onWrite: stopAfter(n) })).toThrow(/stopped/);
      expect(findable(id, t)).toBeNull();
      expect(fs.existsSync(path.join(t, `${id}.json`))).toBe(false);
      expect(listInstalled(t).find((p) => p.id === id)?.installing).toBe(true);
      installPack(verifyPack(ink, sha256(ink)), t);
      expect(findable(id, t)).toBe(path.join(t, `${id}.json`));
      expect(listInstalled(t)[0]).toMatchObject({ id, installing: false, changed: [], missing: [] });
    });
  }
  it('stopped, then another version: the journal shows the files are its own (the library refused them, exit 3)', () => {
    const t = tmp('stop-other');
    // a version whose document.css differs from 0.1.0, stopped after a few files
    const changed = withManifest(good().map((f) => (f.name.endsWith('core/document.css') ? { ...f, data: Buffer.from(`${f.data}\n/* 0.3 */`) } : f)));
    expect(() => installPack(verifyPack(changed, sha256(changed)), t, { onWrite: stopAfter(10) })).toThrow(/stopped/);
    expect(installPack(verifyPack(ink, sha256(ink)), t)).toMatchObject({ version: '0.1.0' });
    expect(listInstalled(t)[0]).toMatchObject({ changed: [], installing: false });
  });
  it('an update stopped half-way takes the old profile away first: nothing findable until the retry', () => {
    const t = tmp('stop-upgrade');
    installPack(verifyPack(ink, sha256(ink)), t);
    expect(() => installPack(verifyPack(inkV2, sha256(inkV2)), t, { onWrite: stopAfter(0) })).toThrow(/stopped/);
    expect(findable(id, t)).toBeNull();
    installPack(verifyPack(inkV2, sha256(inkV2)), t);
    expect(findable(id, t)).not.toBeNull();
    expect(listInstalled(t)[0].version).toBe('0.2.0');
  });
});

describe('uninstalling (L2-5 c)', () => {
  it('removes every unchanged file and the folders', () => {
    const t = tmp('un');
    installPack(verifyPack(ink, sha256(ink)), t);
    expect(uninstallPack(id, t)).toMatchObject({ removed: 21, kept: [] });
    expect(fs.readdirSync(t)).toEqual([]);
  });
  it('keeps a hand-changed file, lists it, and a later install still refuses to overwrite it', () => {
    const t = tmp('un-kept');
    installPack(verifyPack(ink, sha256(ink)), t);
    const css = path.join(t, id, 'core', 'document.css');
    fs.appendFileSync(css, '\n/* mine */');
    expect(uninstallPack(id, t)).toMatchObject({ kept: [`${id}/core/document.css`] });
    expect(fs.readFileSync(css, 'utf8')).toMatch(/mine/);
    expect(findable(id, t)).toBeNull();
    const listed = listInstalled(t);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id, changed: [`${id}/core/document.css`], keptAfterUninstall: true, profile: null });
    let e = null;
    try { installPack(verifyPack(ink, sha256(ink)), t); } catch (err) { e = err; }
    expect(e?.code).toBe(EXIT.wouldOverwrite);
  });
  it('an install that stopped before its manifest (only the journal): Remove takes its own files away, keeps a foreign one', () => {
    const t = tmp('stop-remove');
    expect(() => installPack(verifyPack(ink, sha256(ink)), t, { onWrite: (name, i) => { if (i >= 5) throw new Error('stopped'); } })).toThrow(/stopped/);
    expect(fs.existsSync(path.join(t, id, 'manifest.json'))).toBe(false);
    expect(listInstalled(t).find((p) => p.id === id)?.installing).toBe(true);
    // a file the user put where the pack would have written one later: not the pack's, so kept
    const later = good().map((f) => f.name).filter((n) => n.endsWith('.css') && !fs.existsSync(path.join(t, n)))[0];
    fs.mkdirSync(path.dirname(path.join(t, later)), { recursive: true });
    fs.writeFileSync(path.join(t, later), '/* mine */');
    const r = uninstallPack(id, t);
    expect(r.removed).toBe(5);
    expect(r.kept).toEqual([later]);
    expect(fs.readFileSync(path.join(t, later), 'utf8')).toBe('/* mine */');
    expect(fs.existsSync(path.join(t, `.${id}.installing`))).toBe(false);
    expect(listInstalled(t).find((p) => p.id === id && p.installing)).toBeUndefined();
  });
  it('a pack that is not installed: refused', () => {
    expect(() => uninstallPack(id, tmp('none'))).toThrow(/not installed/);
    expect(() => uninstallPack('../x', tmp('none'))).toThrow(/not a profile pack id/);
  });
});

describe('a name in another folder pagemd searches (L2-4, exit 4)', () => {
  it("~/.pagemd/profiles has the name: refused, nothing written, nothing removed from ~/.pagemd", () => {
    const home = tmp('home');
    const t = tmp('target');
    const homeProfiles = path.join(home, '.pagemd', 'profiles');
    fs.mkdirSync(homeProfiles, { recursive: true });
    fs.writeFileSync(path.join(homeProfiles, `${id}.json`), '{"id":"pml-sop-ink"}');
    let e = null;
    try { installPack(verifyPack(ink, sha256(ink)), t, { elsewhere: otherProfileFolders({ homePath: home }) }); } catch (err) { e = err; }
    expect(e?.code).toBe(EXIT.existsElsewhere);
    expect(e.message).toContain(path.join(homeProfiles, `${id}.json`));
    expect(e.message).not.toMatch(/install\.mjs/);
    expect(fs.readdirSync(t)).toEqual([]);
    expect(fs.readFileSync(path.join(homeProfiles, `${id}.json`), 'utf8')).toBe('{"id":"pml-sop-ink"}');
  });
  it("a pagemd-library pointer file: the message says to run the library's install.mjs --uninstall", () => {
    const home = tmp('home-ptr');
    const homeProfiles = path.join(home, '.pagemd', 'profiles');
    fs.mkdirSync(homeProfiles, { recursive: true });
    fs.writeFileSync(path.join(homeProfiles, `${id}.json`), '{"id":"pml-sop-ink","description":"Installed by pagemd-library (scripts/install.mjs)"}');
    let e = null;
    try { installPack(verifyPack(ink, sha256(ink)), tmp('t'), { elsewhere: otherProfileFolders({ homePath: home }) }); } catch (err) { e = err; }
    expect(e?.code).toBe(EXIT.existsElsewhere);
    expect(e.message).toMatch(/install\.mjs --uninstall/);
  });
  it("a project's .pagemd/profiles, or a .yaml of the same name, is in the way too; the target itself is not", () => {
    const proj = tmp('proj');
    fs.mkdirSync(path.join(proj, '.pagemd', 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.pagemd', 'profiles', `${id}.yaml`), 'id: x');
    expect(() => installPack(verifyPack(ink, sha256(ink)), tmp('t'), { elsewhere: otherProfileFolders({ projectRoot: proj, homePath: tmp('h') }) })).toThrow(/already exists/);
    const t = tmp('self');
    installPack(verifyPack(ink, sha256(ink)), t, { elsewhere: [t] });
    expect(findable(id, t)).not.toBeNull();
  });
});

describe('pagemdMinVersion (L2-10)', () => {
  const withMin = (min) => {
    const m = JSON.parse(good().find((f) => f.name === `${id}/manifest.json`).data);
    m.pagemdMinVersion = min;
    const zip = writeZip(good().map((f) => (f.name === `${id}/manifest.json` ? { ...f, data: Buffer.from(JSON.stringify(m, null, 2)) } : f)));
    return verifyPack(zip, sha256(zip));
  };
  it('above the running pagemd: refused, saying which is needed', () => {
    const t = tmp('min');
    expect(() => installPack(withMin('0.0.1-rc5'), t, { pagemdVersion: '0.0.1-rc4' })).toThrow(/needs pagemd 0\.0\.1-rc5 or later; this pagemd is 0\.0\.1-rc4/);
    expect(fs.readdirSync(t)).toEqual([]);
  });
  it('equal or below installs; null installs and keeps its requires text', () => {
    expect(installPack(withMin('0.0.1-rc4'), tmp('eq'), { pagemdVersion: '0.0.1-rc4' }).written).toBe(22);
    expect(installPack(withMin('0.0.1-rc3'), tmp('lt'), { pagemdVersion: '0.0.1-rc4' }).written).toBe(22);
    const t = tmp('null');
    installPack(verifyPack(ink, sha256(ink)), t, { pagemdVersion: '0.0.1-rc4' });
    expect(listInstalled(t)[0]).toMatchObject({ pagemdMinVersion: null, requires: expect.stringMatching(/R-259/) });
  });
  it('compareVersions', () => {
    expect(compareVersions('0.0.1-rc3', '0.0.1-rc4')).toBe(-1);
    expect(compareVersions('0.0.1-rc10', '0.0.1-rc4')).toBe(1);
    expect(compareVersions('0.0.1', '0.0.1-rc9')).toBe(1);
    expect(compareVersions('0.1.0', '0.0.9')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('v1.2', '1.2.0')).toBe(0);
  });
});

describe('the index and the default folder', () => {
  it('parseIndex and latestPacks', () => {
    const index = readIndexFile(path.join(LIB, 'index.json'));
    expect(latestPacks(index, compareVersions).map((p) => p.file)).toEqual(['pml-sop-ink-0.1.0.zip', 'uofo-sop-0.1.0.zip']);
    expect(() => parseIndex('{}')).toThrow(/not a profile pack index/);
    expect(() => parseIndex('{"packs":[{"id":"a","file":"../a.zip","sha256":"x"}]}')).toThrow(/plain file name/);
    expect(() => parseIndex(' '.repeat(1024 * 1024 + 1))).toThrow(/larger than/);
  });
  it('PAGEMD_CONFIG_DIR moves the default target (this suite set it to a temporary folder)', () => {
    expect(defaultTarget()).toBe(path.join(process.env.PAGEMD_CONFIG_DIR, 'profiles'));
    expect(defaultTargetInfo().reason).toBe('PAGEMD_CONFIG_DIR');
    expect(defaultTarget({ env: {}, platform: 'darwin', homePath: '/Users/x' })).toBe('/Users/x/Library/Application Support/pagemd/profiles');
  });
});

describe('fixture packs carry their fonts\' licence (SAN-0a)', () => {
  // The SIL OFL requires its text to travel with the Inter fonts; the library now puts LICENSE.txt beside them.
  const unlicensed = (zip) => {
    const names = readZip(zip).filter((e) => !e.isDir).map((e) => e.name);
    return names.filter((n) => /\.(woff2?|ttf|otf)$/i.test(n) && !names.includes(path.posix.join(path.posix.dirname(n), 'LICENSE.txt')));
  };
  it('every font in every fixture has LICENSE.txt (the SIL OFL text) in its folder', () => {
    for (const zip of [ink, uofo, inkV2]) {
      expect(unlicensed(zip)).toEqual([]);
      const lic = readZip(zip).find((e) => e.name.endsWith('/core/fonts/LICENSE.txt'));
      expect(lic.data.toString('utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });
  it('the check finds a font whose licence was left out', () => {
    const files = readZip(ink).filter((e) => !e.isDir && !e.name.endsWith('LICENSE.txt')).map(({ name, data }) => ({ name, data }));
    expect(unlicensed(writeZip(files)).length).toBe(4);
  });
});
