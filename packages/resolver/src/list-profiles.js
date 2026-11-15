/**
 * One listing of the profiles a document can name (phase L2-7, R-263, R-264): used by `pagemd profiles list` and the
 * editor's profile picker, so both show the same names from the same folders.
 *
 * Folders listed, in the search's order (search.js): the document folder's `profiles/` and `.pagemd/profiles/`, the
 * project's `profiles/` and `.pagemd/profiles/`, the shared profiles folder (profile packs), `~/.pagemd/profiles/` and
 * pagemd's own `profiles/`. The bare document and project folders are searched by the engine too (a `<name>.json` lying
 * there is found) but are not listed: they hold the documents themselves, not a set of profiles.
 *
 * **A name found twice is reported, not hidden** (R-264: it stays an error when building): every entry carries the
 * other files with its name in `duplicates`. A profile pack's version is read from `<folder>/<name>/manifest.json`.
 */

import { fsOp, loggerOf } from './ports.js';
import { pathOf } from './path.js';
import { findProjectRootGen, scanResourceFolderGen } from './discover.js';
import { isFileGen } from './search.js';

/** The tiers, in the search's order. */
export const PROFILE_TIERS = Object.freeze(['document', 'project', 'workspace', 'shared', 'home', 'pagemd']);

/**
 * The folders `listProfiles` reads, in order, each once. No file access.
 * @param {{ documentDir?: string|null, projectRoot?: string|null, cliPath?: string|null }} where
 * @param {import('./ports.js').Ports} [ports] - `env.sharedProfilesPath`, `env.homePath`, `env.defaultsPath`
 * @returns {{ tier: string, folder: string }[]}
 */
export function profileListFolders(where = {}, ports = {}) {
  const P = pathOf(ports.env);
  const out = [];
  const seen = new Set();
  const add = (tier, folder) => {
    if (!folder) return;
    const normalized = P.normalize(folder);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ tier, folder: normalized });
  };
  const { documentDir = null, projectRoot = null } = where;
  const cliPath = where.cliPath !== undefined ? where.cliPath : (ports.env?.defaultsPath ?? null);
  const docIsRoot = documentDir && projectRoot && P.normalize(documentDir) === P.normalize(projectRoot);
  if (documentDir && !docIsRoot) {
    add('document', P.join(documentDir, 'profiles'));
    add('document', P.join(documentDir, '.pagemd', 'profiles'));
  }
  if (projectRoot) {
    add('project', P.join(projectRoot, 'profiles'));
    add('workspace', P.join(projectRoot, '.pagemd', 'profiles'));
  }
  add('shared', ports.env?.sharedProfilesPath);
  if (ports.env?.homePath) add('home', P.join(ports.env.homePath, '.pagemd', 'profiles'));
  if (cliPath) add('pagemd', P.join(cliPath, 'profiles'));
  return out;
}

/** A pack's manifest next to its profile, or null. */
function* packManifestGen(folder, name, ports) {
  const P = pathOf(ports.env);
  const file = P.join(folder, name, 'manifest.json');
  if (!(yield* isFileGen(file))) return null;
  try {
    const manifest = JSON.parse(yield fsOp.readText(file));
    return manifest && typeof manifest === 'object' ? manifest : null;
  } catch {
    return null;
  }
}

/**
 * Every profile a document can name, with where it is.
 * @param {{ documentPath?: string|null, projectRoot?: string|null, cliPath?: string|null }} [where] - `projectRoot`
 *   skips the project-root search when given (even null); without a document the search starts at `env.cwd`
 * @param {import('./ports.js').Ports} [ports]
 * @returns {Generator<object, ProfileEntry[]>} sorted by name, then by tier
 *
 * @typedef {object} ProfileEntry
 * @property {string} name - what a document writes (`profile: <name>`)
 * @property {string} path - the profile file
 * @property {string} tier - one of PROFILE_TIERS
 * @property {string} folder - the folder it was listed from
 * @property {string|null} description
 * @property {string} [version] - a profile pack's version (its `<name>/manifest.json`)
 * @property {{ version?: string, built?: string, pagemdMinVersion?: string|null, requires?: string }} [pack]
 * @property {string[]} duplicates - the other files with the same name (empty when the name is unique)
 */
export function* listProfilesGen(where = {}, ports = {}) {
  const P = pathOf(ports.env);
  const logger = loggerOf(ports, 'discovery');
  const documentPath = where.documentPath ?? null;
  const documentDir = documentPath ? P.dirname(documentPath) : null;
  const projectRoot = where.projectRoot !== undefined
    ? where.projectRoot
    : yield* findProjectRootGen(documentDir || ports.env?.cwd || '.', ports);

  const entries = [];
  for (const { tier, folder } of profileListFolders({ documentDir, projectRoot, cliPath: where.cliPath }, ports)) {
    const found = yield* scanResourceFolderGen(folder, 'profiles', tier, ports);
    for (const r of found) {
      if (r.name.startsWith('.')) continue; // hidden files (an install's journal) are never profiles
      const entry = { name: r.name, path: r.path, tier, folder, description: r.description ?? null, duplicates: [] };
      const manifest = yield* packManifestGen(folder, r.name, ports);
      if (manifest) {
        if (typeof manifest.version === 'string') entry.version = manifest.version;
        entry.pack = {
          ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
          ...(typeof manifest.built === 'string' ? { built: manifest.built } : {}),
          pagemdMinVersion: typeof manifest.pagemdMinVersion === 'string' ? manifest.pagemdMinVersion : null,
          ...(typeof manifest.requires === 'string' ? { requires: manifest.requires } : {})
        };
      }
      entries.push(entry);
    }
  }

  const byName = new Map();
  for (const e of entries) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const e of group) e.duplicates = group.filter((o) => o !== e).map((o) => o.path);
    logger.warn('profiles', 'duplicate', `Profile name found more than once: ${group[0].name}`, { paths: group.map((e) => e.path) });
  }
  const order = (tier) => PROFILE_TIERS.indexOf(tier);
  entries.sort((a, b) => a.name.localeCompare(b.name) || order(a.tier) - order(b.tier));
  return entries;
}
