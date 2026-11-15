/**
 * Where packs come from and go (phase L2-6): the default target (the shared profiles folder), the other folders pagemd
 * searches (for L2-4), and the library's `index.json` (the checksum of every zip).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSearchPaths, sharedProfilesFolderInfo } from '@pagemd/resolver';
import { EXIT, PackError } from './verify.js';

/**
 * The shared profiles folder for this computer and why (the resolver's rule with this process's environment):
 * `$PAGEMD_CONFIG_DIR/profiles` when it is set.
 * @returns {{ path: string, reason: string }}
 */
export function defaultTargetInfo({ env = process.env, platform = process.platform, homePath = os.homedir() } = {}) {
  return sharedProfilesFolderInfo({
    platform,
    env,
    homePath,
    exists: (p) => fs.existsSync(p),
    list: (p) => fs.readdirSync(p),
    osRelease: os.release(),
    path
  });
}

/** The shared profiles folder (see defaultTargetInfo). */
export function defaultTarget(options) {
  return defaultTargetInfo(options).path;
}

/**
 * Every other folder pagemd searches for a profile by name (the resolver's own list, without the shared tier): the
 * project root and its `profiles/` and `.pagemd/profiles/` (when inside a project), `~/.pagemd/profiles` and pagemd's
 * own `profiles/`.
 */
export function otherProfileFolders({ projectRoot = null, homePath = os.homedir(), cliPath = null } = {}) {
  return buildSearchPaths('profiles', { workspacePath: projectRoot, homePath, cliPath, sourceType: 'cli' }, { env: { path } });
}

/** The index's limit (L3 downloads it; also guards a local file). */
export const MAX_INDEX = 1024 * 1024;

/**
 * Read a library `index.json` (schema 1): `{ packs: [{ id, version, file, size, sha256, ... }], latest: { id: {...} } }`.
 * @throws {PackError} usage (2) when it is not an index
 */
export function parseIndex(text, where = 'index.json') {
  if (text.length > MAX_INDEX) throw new PackError(`${where} is larger than ${MAX_INDEX} bytes`, EXIT.usage);
  let index;
  try { index = JSON.parse(text); } catch (e) { throw new PackError(`${where} is not valid JSON (${e.message})`, EXIT.usage); }
  if (!index || typeof index !== 'object' || !Array.isArray(index.packs)) throw new PackError(`${where} is not a profile pack index (no "packs" list)`, EXIT.usage);
  if (index.schema !== undefined && index.schema !== 1) throw new PackError(`${where} has schema ${index.schema}; this pagemd reads schema 1`, EXIT.usage);
  for (const p of index.packs) {
    if (!p || typeof p.file !== 'string' || typeof p.sha256 !== 'string' || typeof p.id !== 'string') throw new PackError(`${where} has a pack entry without id, file or sha256`, EXIT.usage);
    if (p.file !== path.basename(p.file) || p.file.includes('\\')) throw new PackError(`${where}: "${p.file}" is not a plain file name`, EXIT.usage);
  }
  return { ...index, latest: index.latest && typeof index.latest === 'object' ? index.latest : {} };
}

/** Read an index file. */
export function readIndexFile(file) {
  if (!fs.existsSync(file)) throw new PackError(`no index found at ${file}; give --index or --sha256`, EXIT.usage);
  return parseIndex(fs.readFileSync(file, 'utf8'), file);
}

/** The newest entry for each id: `latest` when it names a listed file, else the highest version listed. */
export function latestPacks(index, compare) {
  const out = new Map();
  for (const p of index.packs) {
    const named = index.latest[p.id];
    if (named?.file) {
      if (named.file === p.file) out.set(p.id, p);
      continue;
    }
    const have = out.get(p.id);
    if (!have || compare(p.version ?? '0', have.version ?? '0') > 0) out.set(p.id, p);
  }
  for (const [id, named] of Object.entries(index.latest)) {
    if (!out.has(id) && named?.file) {
      const p = index.packs.find((x) => x.file === named.file);
      if (p) out.set(id, p);
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}
