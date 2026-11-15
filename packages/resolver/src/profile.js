/**
 * Profiles: find, read, inherit (`extends`), merge, check (from pagemd `core/src/config.js` and
 * `core/src/profile-loader.js`, phase C4).
 *
 * Inheritance: one parent per profile (`extends`); objects deep-merge, arrays are replaced, a `null`
 * in the child keeps the parent's value; a cycle is an error.
 *
 * Finding a profile by name uses the 5-tier search (`sourceType: 'cli'`); a name that looks like a
 * path (has a slash, or ends in .json/.yaml/.yml) is read from that path instead, relative to the
 * search folder or the working folder (lookup 5 in the C4 side-by-side).
 *
 * Checking: rendering only *warns* when a profile's `id` differs from its file name.
 * `validateProfile` (which throws on that) is not called while rendering; `pagemd validate` and C8
 * decide its use.
 */

import { fsOp, loggerOf } from './ports.js';
import { pathOf, resolveFrom } from './path.js';
import { resolveResourceGen } from './search.js';
import { loadYaml } from './yaml.js';

/** The profile used when none is named. */
export function getDefaultProfile() {
  return 'standard_letter';
}

/** Where each loaded profile object was read from (for `sources`), without touching the object. */
const profilePaths = new WeakMap();

/** The file a profile object was read from, if the resolver read it. */
export function profileSourcePath(profile) {
  return profile && typeof profile === 'object' ? profilePaths.get(profile) ?? null : null;
}

/**
 * The resources whose paths may be relative to the profile that wrote them (P5, R-136): `./`, `../`, a bare
 * name found next to the profile (the search's profile-folder tier) and `${manifestPath}`. Dotted keys into the
 * profile object; arrays are replaced whole by `extends`, so one folder serves a whole array.
 */
export const RESOURCE_KEYS = Object.freeze([
  'resources.template',
  'resources.layout',
  'resources.css',
  'resources.fonts',
  'resources.assets',
  'layout.source',
  'layout.css',
  'styles.profile'
]);

/** For merged profiles: resource key → the folder of the profile in the `extends` chain that wrote it. */
const resourceFolders = new WeakMap();

const valueAt = (profile, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), profile);
const hasValue = (profile, key) => {
  const value = valueAt(profile, key);
  return value !== undefined && value !== null; // `null` in a child means "inherit" (deepMerge)
};

/**
 * The folder a profile resource's relative paths start from (R-136): the folder of the profile in the `extends`
 * chain that wrote that resource (a child that overrides it: the child's), else the profile's own `_manifestDir`.
 * Before R-136 every inherited path used the named (child) profile's folder, so a parent's `../styles/x.css` was
 * looked up from the child's folder.
 * @param {object} profile - a loaded or merged profile
 * @param {string} key - one of RESOURCE_KEYS
 * @returns {string|null}
 */
export function resourceFolder(profile, key) {
  if (!profile || typeof profile !== 'object') return null;
  const folders = resourceFolders.get(profile);
  if (folders && Object.hasOwn(folders, key)) return folders[key];
  return profile._manifestDir ?? null;
}

/** The resource folders of `child` merged onto `parent` (see resourceFolder). */
function mergedResourceFolders(parent, child) {
  const out = {};
  for (const key of RESOURCE_KEYS) {
    if (hasValue(child, key)) out[key] = resourceFolder(child, key);
    else if (hasValue(parent, key)) out[key] = resourceFolder(parent, key);
  }
  return out;
}

/**
 * Deep-merge two objects: objects merge recursively, arrays are replaced, a `null` child value
 * keeps the parent's.
 */
function deepMerge(parent, child) {
  if (child === null) {
    return parent;
  }
  if (typeof parent !== 'object' || parent === null) {
    return child;
  }
  if (typeof child !== 'object') {
    return child;
  }
  if (Array.isArray(parent) || Array.isArray(child)) {
    return child;
  }

  const result = { ...parent };
  for (const key in child) {
    if (Object.prototype.hasOwnProperty.call(child, key)) {
      const childValue = child[key];
      if (childValue === null) {
        continue; // null means "inherit from parent"
      }
      if (typeof childValue === 'object' && !Array.isArray(childValue) &&
          typeof parent[key] === 'object' && parent[key] !== null && !Array.isArray(parent[key])) {
        result[key] = deepMerge(parent[key], childValue);
      } else {
        result[key] = childValue;
      }
    }
  }
  return result;
}

/**
 * Merge a child profile onto its parent (deep-merge objects, replace arrays). The result remembers which
 * profile's folder each resource came from (resourceFolder, R-136).
 * @returns {object}
 */
export function mergeProfiles(parent, child, ports = {}) {
  const logger = loggerOf(ports, 'profiles');
  logger.trace('inheritance', 'in-progress', 'Merging profiles', {
    parent: parent.id,
    child: child.id
  });

  const merged = deepMerge(parent, child);
  // Where each resource's relative paths start from (R-136); `_manifestDir` stays the child's
  if (merged && typeof merged === 'object' && merged !== parent) {
    resourceFolders.set(merged, mergedResourceFolders(parent, child));
  }

  logger.debug('inheritance', 'success', 'Profiles merged', {
    parent: parent.id,
    child: child.id,
    result: merged.id
  });

  return merged;
}

/**
 * Check a profile's structure: it needs an `id`, equal to its file name.
 * @throws {Error}
 */
export function validateProfile(profile, filename, ports = {}) {
  const logger = loggerOf(ports, 'profiles');
  logger.trace('validation', 'in-progress', 'Validating profile', {
    profile: profile.id,
    filename
  });

  if (!profile.id) {
    const error = new Error(`Profile missing required 'id' field`);
    logger.error('validation', 'failure', 'Profile missing id', { filename });
    throw error;
  }

  if (profile.id !== filename) {
    const error = new Error(
      `Profile ID '${profile.id}' does not match filename '${filename}'. Profile ID must match filename exactly.`
    );
    logger.error('validation', 'failure', 'Profile ID mismatch', {
      profileId: profile.id,
      filename
    });
    throw error;
  }

  logger.debug('validation', 'success', 'Profile validated', {
    profile: profile.id,
    filename
  });
}

/** true when the input looks like a file path rather than a profile name */
export function isProfilePath(input) {
  if (!input || typeof input !== 'string') return false;
  if (input.includes('/') || input.includes('\\')) return true;
  const lower = input.toLowerCase();
  return lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml');
}

function parseProfileText(content, resolvedPath) {
  if (resolvedPath.endsWith('.json')) {
    return JSON.parse(content);
  }
  if (resolvedPath.endsWith('.yaml') || resolvedPath.endsWith('.yml')) {
    return loadYaml(content);
  }
  throw new Error(`Unsupported profile file extension: ${resolvedPath}`);
}

/**
 * Read a profile from a file path (absolute, or relative to `baseDir`, else the working folder).
 * @returns {Generator<object, object|null>} null when the file doesn't exist
 */
function* loadProfileFromPathGen(profilePath, baseDir, ports) {
  const P = pathOf(ports.env);
  const logger = loggerOf(ports, 'io');
  logger.trace('profiles', 'path-resolve', 'Resolving profile file path', { path: profilePath, baseDir });

  // Windows-style separators work on every platform
  const normalizedPath = profilePath.replace(/\\/g, '/');

  let resolvedPath;
  if (P.isAbsolute(normalizedPath)) {
    resolvedPath = normalizedPath;
  } else {
    const base = baseDir || ports.env?.cwd;
    resolvedPath = base ? resolveFrom(ports.env, base, normalizedPath) : resolveFrom(ports.env, normalizedPath);
  }

  // No extension: try the profile extensions
  if (!P.extname(resolvedPath)) {
    for (const ext of ['.json', '.yaml', '.yml']) {
      const pathWithExt = `${resolvedPath}${ext}`;
      if (yield fsOp.exists(pathWithExt)) {
        resolvedPath = pathWithExt;
        logger.trace('profiles', 'path-ext-found', 'Profile file found with extension', {
          original: profilePath,
          resolved: resolvedPath
        });
        break;
      }
    }
  }

  if (!(yield fsOp.exists(resolvedPath))) {
    logger.warn('profiles', 'path-not-found', 'Profile file path does not exist', {
      input: profilePath,
      resolved: resolvedPath
    });
    return null;
  }

  try {
    logger.debug('profiles', 'path-loading', 'Loading profile from file path', {
      path: resolvedPath
    });

    const content = yield fsOp.readText(resolvedPath);
    const profile = parseProfileText(content, resolvedPath);

    // The profile's folder, for ${manifestPath} and profile-relative searches
    profile._manifestDir = P.dirname(resolvedPath);
    profilePaths.set(profile, resolvedPath);

    logger.info('profiles', 'path-success', 'Profile loaded from file path', {
      path: resolvedPath,
      id: profile.id,
      manifestDir: profile._manifestDir
    });

    return profile;
  } catch (err) {
    logger.error('profiles', 'path-failure', 'Failed to load profile from file path', {
      path: resolvedPath,
      error: err.message
    });
    throw new Error(`Failed to load profile from ${resolvedPath}: ${err.message}`);
  }
}

/**
 * Load one profile (no inheritance) by name or path.
 *
 * `variant` keeps a difference between pagemd's two loaders: `'sync'` (loadProfileSync, what
 * rendering uses) treats an empty name as the default profile and reads a relative path from the
 * search folder; `'async'` (loadProfile) does neither and reads a relative path from the working
 * folder.
 *
 * @param {string} profileName
 * @param {{ searchFrom?: string|null, configDir?: string|null, cliPath?: string|null, variant?: 'sync'|'async' }} where
 * @param {import('./ports.js').Ports} ports
 * @returns {Generator<object, object|null>} null when not found
 * @throws {Error} when the file exists but can't be read or parsed
 */
export function* loadProfileGen(profileName, where = {}, ports = {}) {
  const { searchFrom = null, configDir = null, cliPath = null, variant = 'sync' } = where;
  const logger = loggerOf(ports, 'io');
  const cache = ports.cache;
  const cwd = ports.env?.cwd;

  if (variant === 'sync' && (!profileName || (typeof profileName === 'string' && profileName.trim() === ''))) {
    logger.debug('profiles', 'default', 'No profile specified, using default', {
      input: profileName
    });
    return yield* loadProfileGen(getDefaultProfile(), where, ports);
  }

  if (isProfilePath(profileName)) {
    const baseDir = variant === 'sync' ? (searchFrom || cwd) : cwd;
    logger.trace('profiles', 'path-mode', 'Profile input detected as file path',
      variant === 'sync' ? { profile: profileName, searchFrom } : { profile: profileName });
    const cacheKey = `profile-path:${baseDir ? resolveFrom(ports.env, baseDir, profileName) : resolveFrom(ports.env, profileName)}`;
    if (cache?.has(cacheKey)) {
      logger.debug('profiles', 'cache-hit', 'Profile loaded from cache (path)', { profile: profileName });
      return cache.get(cacheKey);
    }
    const profile = yield* loadProfileFromPathGen(profileName, variant === 'sync' ? baseDir : null, ports);
    cache?.set(cacheKey, profile);
    return profile;
  }

  const cacheKey = `profile:${profileName}:${searchFrom || 'default'}:${configDir || 'default'}:${cliPath || 'default'}`;
  if (cache?.has(cacheKey)) {
    logger.debug('profiles', 'cache-hit', 'Profile loaded from cache', { profile: profileName });
    return cache.get(cacheKey);
  }

  logger.trace('profiles', 'searching', 'Searching for profile', {
    profile: profileName,
    searchFrom,
    configDir,
    cliPath
  });

  const context = {
    workingPath: searchFrom,
    workspacePath: configDir || searchFrom || cwd,
    cliPath,
    sourceType: 'cli'
  };

  try {
    const { resolvedPath } = yield* resolveResourceGen(profileName, 'profiles', context, ports);

    logger.debug('profiles', 'loading', 'Loading profile from file', {
      profile: profileName,
      file: resolvedPath
    });

    const content = yield fsOp.readText(resolvedPath);
    const profile = parseProfileText(content, resolvedPath);

    profile._manifestDir = pathOf(ports.env).dirname(resolvedPath);
    profilePaths.set(profile, resolvedPath);

    logger.info('profiles', 'success', 'Profile loaded', {
      profile: profileName,
      file: resolvedPath,
      id: profile.id,
      manifestDir: profile._manifestDir
    });

    // Rendering only warns when the id differs from the file name
    if (profile.id !== profileName) {
      logger.warn('profiles', 'mismatch', 'Profile ID does not match filename', {
        profile: profileName,
        profileId: profile.id,
        file: resolvedPath
      });
    }

    cache?.set(cacheKey, profile);
    return profile;
  } catch (err) {
    logger.error('profiles', 'failure', 'Failed to load profile', {
      profile: profileName,
      error: err.message
    });

    cache?.set(cacheKey, null);

    // Anything but "not found" is a real error
    if (!err.message.includes('not found')) {
      throw new Error(`Failed to load profile ${profileName}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Throw if following `extends` from `profileName` comes back to a profile already in `chain`.
 * @param {(name: string) => Generator} loadGen - loads one profile (no inheritance)
 * @returns {Generator<object, void>}
 */
export function* detectCircularInheritanceGen(profileName, chain, loadGen, ports = {}) {
  const logger = loggerOf(ports, 'profiles');
  if (chain.includes(profileName)) {
    const cycleStart = chain.indexOf(profileName);
    const cycle = [...chain.slice(cycleStart), profileName];
    const error = new Error(`Circular inheritance detected: ${cycle.join(' -> ')}`);
    logger.error('inheritance', 'failure', 'Circular inheritance detected', {
      profile: profileName,
      chain,
      cycle
    });
    throw error;
  }

  const profile = yield* loadGen(profileName);
  if (!profile) {
    const error = new Error(`Profile not found in inheritance chain: ${profileName}`);
    logger.error('inheritance', 'failure', 'Profile not found', {
      profile: profileName,
      chain
    });
    throw error;
  }

  if (profile.extends) {
    yield* detectCircularInheritanceGen(profile.extends, [...chain, profileName], loadGen, ports);
  }
}

/**
 * Load a profile and its whole `extends` chain, merged (parent first).
 * @param {{ searchFrom?: string|null, configDir?: string|null, cliPath?: string|null }} context
 * @returns {Generator<object, object>}
 * @throws {Error} not found, a cycle, or an unreadable profile
 */
export function* loadAndMergeProfileGen(profileName, context = {}, ports = {}) {
  const { searchFrom = null, configDir = null, cliPath = null } = context;
  const logger = loggerOf(ports, 'profiles');

  logger.info('loading', 'in-progress', 'Loading profile with inheritance', {
    profile: profileName,
    searchFrom,
    configDir,
    cliPath
  });

  const loadGen = (name) => loadProfileGen(name, { searchFrom, configDir, cliPath, variant: 'sync' }, ports);

  try {
    yield* detectCircularInheritanceGen(profileName, [], loadGen, ports);
  } catch (err) {
    logger.error('loading', 'failure', 'Circular inheritance check failed', {
      profile: profileName,
      error: err.message
    });
    throw err;
  }

  const profile = yield* loadGen(profileName);
  if (!profile) {
    const error = new Error(`Profile not found: ${profileName}`);
    logger.error('loading', 'failure', 'Profile not found', { profile: profileName });
    throw error;
  }

  if (!profile.extends) {
    logger.info('loading', 'success', 'Profile loaded (no inheritance)', {
      profile: profileName
    });
    return profile;
  }

  logger.debug('inheritance', 'in-progress', 'Resolving parent chain', {
    profile: profileName,
    extends: profile.extends
  });

  const parent = yield* loadAndMergeProfileGen(profile.extends, context, ports);
  const merged = mergeProfiles(parent, profile, ports);

  logger.info('loading', 'success', 'Profile loaded with inheritance', {
    profile: profileName,
    parent: profile.extends
  });

  return merged;
}
