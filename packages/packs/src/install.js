/**
 * Installing, removing and listing profile packs on disk (phase L2-4, L2-5, L2-10).
 *
 * The library's `installPack`/`uninstallPack` (pagemd-library `scripts/unpack.mjs`) with the same rules, and stricter
 * in three ways (plan L2-5):
 *   (a) order: every other file first, then `<id>/manifest.json`, then `<id>.json` **last**, so an install that stops
 *       half-way leaves no profile pagemd can find (the search finds `<id>.json`). An update takes the old `<id>.json`
 *       away first, for the same reason;
 *   (b) a journal, `.<id>.installing` in the target, written before the first file and removed after the last: a retry
 *       recognises the files it wrote itself (the library refused them, exit 3);
 *   (c) an uninstall that keeps hand-changed files rewrites the manifest to list only those, so `listInstalled` still
 *       shows them and a later install still refuses to overwrite them.
 * Never overwritten: a file the pack did not write, or one changed by hand since (exit 3). Never created: a profile
 * name that already exists in another folder pagemd searches (exit 4, R-264: a name found twice stays an error).
 * Nothing is ever removed outside the target, and nothing from `~/.pagemd/profiles` (R-264).
 */

import fs from 'node:fs';
import path from 'node:path';
import { badName, sha256 } from './rules.js';
import { EXIT, PackError } from './verify.js';

/** The text pagemd-library's `install.mjs` writes into its pointer files' description. */
export const LIBRARY_POINTER_MARK = 'Installed by pagemd-library';

const PROFILE_EXTENSIONS = ['.json', '.yaml', '.yml'];

const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const fileSha = (p) => sha256(fs.readFileSync(p));
const journalPath = (root, id) => path.join(root, `.${id}.installing`);

/**
 * Compare two version numbers, `x.y.z` with an optional `-pre` part (`0.0.1-rc3` < `0.0.1-rc4` < `0.0.1-rc10` < `0.0.1`).
 * A pre-release part is compared piece by piece, numbers as numbers. → -1, 0, 1
 */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [main, ...pre] = String(v).trim().replace(/^v/i, '').split('+')[0].split('-');
    return { main: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre.join('-') };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.main.length, y.main.length); i++) {
    const d = (x.main[i] ?? 0) - (y.main[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const chunks = (s) => s.match(/\d+|[^\d]+/g) ?? [];
  const p = chunks(x.pre);
  const q = chunks(y.pre);
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const bothNumbers = /^\d+$/.test(p[i]) && /^\d+$/.test(q[i]);
    const d = bothNumbers ? Number(p[i]) - Number(q[i]) : p[i] < q[i] ? -1 : p[i] > q[i] ? 1 : 0;
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * L2-10: a pack names the pagemd it needs (`pagemdMinVersion`); null installs (its `requires` text is shown by
 * `profiles list`). Throws when the running pagemd is older.
 */
export function checkPagemdVersion(manifest, pagemdVersion) {
  const min = manifest?.pagemdMinVersion;
  if (!min || !pagemdVersion) return;
  if (compareVersions(pagemdVersion, min) < 0) {
    throw new PackError(`not installed: ${manifest.id} ${manifest.version ?? ''} needs pagemd ${min} or later; this pagemd is ${pagemdVersion}`.replace('  ', ' '));
  }
}

/**
 * L2-4: the profile name in another folder pagemd searches. `folders` are the other tiers (`~/.pagemd/profiles`,
 * pagemd's own, a project's profile folders). → [{ path, pointer }] (pointer: a pagemd-library pointer file)
 */
export function findElsewhere(id, folders, target) {
  const root = path.resolve(target);
  const out = [];
  const seen = new Set();
  for (const folder of folders ?? []) {
    if (!folder) continue;
    const dir = path.resolve(folder);
    if (dir === root || seen.has(dir)) continue;
    seen.add(dir);
    for (const ext of PROFILE_EXTENSIONS) {
      const file = path.join(dir, `${id}${ext}`);
      if (!lstat(file)?.isFile()) continue;
      let pointer = false;
      try { pointer = fs.readFileSync(file, 'utf8').includes(LIBRARY_POINTER_MARK); } catch { /* unreadable: still in the way */ }
      out.push({ path: file, pointer });
    }
  }
  return out;
}

function elsewhereError(id, found) {
  const lines = found.map((f) => `  ${f.path}${f.pointer ? ` (a pointer file written by pagemd-library's install.mjs)` : ''}`);
  const pointerHint = found.some((f) => f.pointer)
    ? "\nThe library's pointer files are removed by the library itself: run `node scripts/install.mjs --uninstall` in your pagemd-library checkout, then install again."
    : '\nRename or move that profile (pagemd will not remove it), or install into another folder with --target.';
  return new PackError(
    `not installed: the profile name "${id}" already exists where pagemd looks for profiles, and a name found twice stops every build:\n${lines.join('\n')}${pointerHint}`,
    EXIT.existsElsewhere
  );
}

/** Refuse a target path whose parent folders include a symbolic link, or that is not a plain file. */
function checkSlot(root, rel) {
  let cur = root;
  for (const part of rel.split('/').slice(0, -1)) {
    cur = path.join(cur, part);
    const st = lstat(cur);
    if (st && (st.isSymbolicLink() || !st.isDirectory())) throw new PackError(`refused: ${cur} is a link or not a folder`);
  }
  const st = lstat(path.join(root, rel));
  if (st && !st.isFile()) throw new PackError(`refused: ${path.join(root, rel)} is a link or not a file`);
  return st;
}

/** A manifest's files as path → sha256 (empty when it can't be read). */
function manifestFiles(file) {
  if (!lstat(file)?.isFile()) return new Map();
  try {
    return new Map((JSON.parse(fs.readFileSync(file, 'utf8')).files ?? []).map((f) => [f.path, f.sha256]));
  } catch {
    return new Map();
  }
}

/** The journal of an install that did not finish: path → sha256 of every file it was writing or removing. */
function readJournal(root, id) {
  const file = journalPath(root, id);
  if (!lstat(file)?.isFile()) return null;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j?.id !== id) return null;
    return { version: j.version ?? null, files: new Map([...(j.write ?? []), ...(j.remove ?? [])].map((f) => [f.path, f.sha256])), remove: j.remove ?? [] };
  } catch {
    return null;
  }
}

function writeAtomic(dest, data) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.pagemd-tmp`;
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(tmp, data, { flag: 'wx' });
  fs.renameSync(tmp, dest);
}

/**
 * Install a verified pack (`verifyPack`'s result) into `target`.
 * @param {{ id: string, files: {name: string, data: Buffer}[], manifest: object }} pack
 * @param {string} target - the shared profiles folder (or --target)
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - check everything, write nothing
 * @param {string[]} [options.elsewhere] - other folders pagemd searches for profiles (L2-4, exit 4)
 * @param {string} [options.pagemdVersion] - the running pagemd (L2-10)
 * @param {(name: string, index: number) => void} [options.onWrite] - called before each file is written (progress;
 *   a test throws here to stop an install half-way)
 * @returns {{ id: string, version: string|null, written: number, unchanged: number, removed: number, target: string }}
 */
export function installPack({ id, files, manifest }, target, options = {}) {
  const { dryRun = false, elsewhere = [], pagemdVersion = null, onWrite } = options;
  const root = path.resolve(target);
  checkPagemdVersion(manifest, pagemdVersion);
  const inTheWay = findElsewhere(id, elsewhere, root);
  if (inTheWay.length) throw elsewhereError(id, inTheWay);

  const manifestName = `${id}/manifest.json`;
  const profileName = `${id}.json`;
  const previous = manifestFiles(path.join(root, id, 'manifest.json'));
  const journal = readJournal(root, id);
  const ours = (name, diskSha) => previous.get(name) === diskSha || journal?.files.get(name) === diskSha;

  const plan = [];
  const refused = [];
  for (const f of files) {
    const dest = path.resolve(root, f.name);
    if (dest !== root && !dest.startsWith(root + path.sep)) throw new PackError(`refused: "${f.name}" would land outside the target folder`);
    const st = checkSlot(root, f.name);
    const newSha = sha256(f.data);
    const diskSha = st ? fileSha(dest) : null;
    const same = diskSha === newSha;
    if (st && !same) {
      const manifestOfOurs = f.name === manifestName && (previous.size > 0 || journal);
      if (!manifestOfOurs && !ours(f.name, diskSha)) { refused.push(f.name); continue; }
    }
    plan.push({ name: f.name, dest, data: f.data, sha: newSha, state: !st ? 'new' : same ? 'unchanged' : 'updated' });
  }
  if (refused.length) {
    throw new PackError(`not installed: these files exist and were not written by this pack (or were changed since): ${refused.join(', ')}`, EXIT.wouldOverwrite);
  }

  // files an earlier version (or an unfinished install) wrote that this version no longer has, if unchanged on disk
  const removed = [];
  const now = new Set(files.map((f) => f.name));
  const candidates = new Map(previous);
  for (const r of journal?.remove ?? []) candidates.set(r.path, r.sha256);
  for (const [p, hash] of candidates) {
    if (now.has(p) || p === manifestName || badName(p) || !(p === profileName || p.startsWith(`${id}/`))) continue;
    const dest = path.resolve(root, p);
    if (!dest.startsWith(root + path.sep)) continue;
    if (lstat(dest)?.isFile() && fileSha(dest) === hash) removed.push({ path: p, dest, sha256: hash });
  }

  const changes = plan.filter((p) => p.state !== 'unchanged');
  const result = { id, version: manifest.version ?? null, written: changes.length, unchanged: plan.length - changes.length, removed: removed.length, target: root };
  if (dryRun || (changes.length === 0 && removed.length === 0 && !journal)) return result;

  // (b) the journal first: what this install writes and removes
  fs.mkdirSync(root, { recursive: true });
  writeAtomic(journalPath(root, id), `${JSON.stringify({
    id,
    version: manifest.version ?? null,
    write: plan.map((p) => ({ path: p.name, sha256: p.sha })),
    remove: removed.map((r) => ({ path: r.path, sha256: r.sha256 }))
  }, null, 2)}\n`);

  // (a) the profile goes away first and comes back last, so no half-written pack is ever found by name
  const profile = plan.find((p) => p.name === profileName);
  if (profile && profile.state !== 'new' && changes.length > 0) {
    fs.rmSync(profile.dest, { force: true });
    profile.state = 'updated';
  }
  const order = [
    ...plan.filter((p) => p.name !== manifestName && p.name !== profileName),
    ...plan.filter((p) => p.name === manifestName),
    ...plan.filter((p) => p.name === profileName)
  ];
  let n = 0;
  for (const p of order) {
    if (p.state === 'unchanged') continue;
    onWrite?.(p.name, n++);
    writeAtomic(p.dest, p.data);
  }
  for (const r of removed) fs.rmSync(r.dest, { force: true });
  removeEmptyFolders(path.join(root, id));
  fs.rmSync(journalPath(root, id), { force: true });
  return { ...result, written: plan.filter((p) => p.state !== 'unchanged').length };
}

/** Remove folders under `dir` that are empty, deepest first (`dir` itself too when it ends up empty). */
function removeEmptyFolders(dir) {
  if (!lstat(dir)?.isDirectory()) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) removeEmptyFolders(path.join(dir, e.name));
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/**
 * Remove what a pack wrote: every file its manifest lists that is unchanged on disk, the profile first. A file changed
 * by hand is kept, and the manifest is rewritten to list only the kept files (c). An install that did not finish (no
 * manifest yet, only its journal) is removed the same way from the journal's list (security review item 6: the
 * editor offered Remove for it and this used to answer "not installed").
 * @returns {{ id: string, removed: number, kept: string[], target: string }}
 */
export function uninstallPack(id, target) {
  const root = path.resolve(target);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new PackError(`"${id}" is not a profile pack id`, EXIT.usage);
  const mf = path.join(root, id, 'manifest.json');
  let manifest;
  if (!lstat(mf)?.isFile()) {
    // an install that stopped before its manifest was written: the journal says which files are its own
    const journal = readJournal(root, id);
    if (!journal) throw new PackError(`${id} is not installed in ${root}`);
    manifest = { id, files: [...journal.files].map(([p, sha]) => ({ path: p, sha256: sha })) };
  } else {
    try { manifest = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { throw new PackError(`${id}: its manifest can't be read (${e.message}); nothing removed`); }
  }
  const entries = (manifest.files ?? []).filter((f) => !badName(f.path) && (f.path === `${id}.json` || f.path.startsWith(`${id}/`)));
  entries.sort((a, b) => (a.path === `${id}.json` ? -1 : b.path === `${id}.json` ? 1 : 0));
  let removed = 0;
  const kept = [];
  for (const f of entries) {
    const dest = path.resolve(root, f.path);
    if (!dest.startsWith(root + path.sep)) continue;
    const st = lstat(dest);
    if (!st) continue;
    if (st.isFile() && fileSha(dest) === f.sha256) { fs.rmSync(dest); removed++; } else kept.push(f);
  }
  if (kept.length) {
    writeAtomic(mf, `${JSON.stringify({ ...manifest, files: kept, keptAfterUninstall: true }, null, 2)}\n`);
  } else {
    fs.rmSync(mf, { force: true });
  }
  // leftovers of a write that stopped half-way (writeAtomic's temporary files)
  for (const f of entries) {
    const tmp = path.resolve(root, `${f.path}.pagemd-tmp`);
    if (tmp.startsWith(root + path.sep) && lstat(tmp)?.isFile()) fs.rmSync(tmp);
  }
  fs.rmSync(journalPath(root, id), { force: true });
  removeEmptyFolders(path.join(root, id));
  return { id, removed, kept: kept.map((f) => f.path), target: root };
}

/**
 * The packs installed in `target`: one entry per `<id>/manifest.json`, plus installs that did not finish.
 * @returns {{ id: string, version: string|null, built: string|null, type: string|null, look: string|null,
 *   pagemdMinVersion: string|null, requires: string|null, profile: string|null, changed: string[], missing: string[],
 *   installing: boolean, keptAfterUninstall: boolean }[]}
 */
export function listInstalled(target) {
  const root = path.resolve(target);
  if (!lstat(root)?.isDirectory()) return [];
  const out = new Map();
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const mf = path.join(root, e.name, 'manifest.json');
    if (!lstat(mf)?.isFile()) continue;
    let m;
    try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { continue; }
    if (m?.id !== e.name) continue;
    const changed = [];
    const missing = [];
    for (const f of m.files ?? []) {
      if (badName(f.path)) continue;
      const dest = path.resolve(root, f.path);
      const st = lstat(dest);
      if (!st?.isFile()) missing.push(f.path);
      else if (fileSha(dest) !== f.sha256) changed.push(f.path);
    }
    const profile = path.join(root, `${e.name}.json`);
    out.set(e.name, {
      id: e.name,
      version: m.version ?? null,
      built: m.built ?? null,
      type: m.type ?? null,
      look: m.look ?? null,
      pagemdMinVersion: m.pagemdMinVersion ?? null,
      requires: m.requires ?? null,
      profile: lstat(profile)?.isFile() ? profile : null,
      changed,
      missing: m.keptAfterUninstall ? [] : missing,
      installing: Boolean(lstat(journalPath(root, e.name))),
      keptAfterUninstall: Boolean(m.keptAfterUninstall)
    });
  }
  for (const name of fs.readdirSync(root)) {
    const m = /^\.(.+)\.installing$/.exec(name);
    if (!m || out.has(m[1])) continue;
    const j = readJournal(root, m[1]);
    out.set(m[1], { id: m[1], version: j?.version ?? null, built: null, type: null, look: null, pagemdMinVersion: null, requires: null, profile: null, changed: [], missing: [], installing: true, keptAfterUninstall: false });
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}
