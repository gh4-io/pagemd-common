/**
 * Finding resource files (from pagemd `core/src/path-resolver.js`, phase C4).
 *
 * Three of pagemd's lookups live here, ported unchanged and **not** unified (the user decides that
 * later; OQ-10 is assigned to C8):
 *
 * 1. `resolveResource`: the **5-tier search** (R-24), **6 tiers for profiles** (phase L2, R-263). The
 *    code's behaviour is the spec:
 *      1. the document's folder (workingPath)
 *      2. the profile's folder (manifestPath), only for paths that came from a profile
 *      3. the workspace root (workspacePath)
 *         (1–3 each check `./`, `./{type}/`, `./.pagemd/{type}/`, and for styles also
 *          `./{type}/{presets,syntax,vendor}/` and `./.pagemd/{type}/{presets,syntax,vendor}/`)
 *      4. profiles only: the shared profiles folder (`env.sharedProfilesPath`, see shared-folder.js),
 *         where profile packs are installed
 *      5. `~/.pagemd/{type}/` (+ the style subfolders) only
 *      6. the bundled defaults `{cliPath}/{type}/` (+ the style subfolders) only
 *    A folder listed twice is searched once. **Every** folder is searched: a name found in more than
 *    one is an error ("Duplicate resources found"), not "the first one wins". Absolute paths are used
 *    as they are; `./` and `../` paths resolve from the profile's folder, else the document's, else
 *    the workspace, without a search. A name without an extension also matches the type's extensions.
 *    A match must be a **file** (L2-2): a folder named like the resource (a profile pack's own
 *    `<name>/` folder next to `<name>.json`) is not a match.
 * 2. `resolveResourcePath`: 3 folders (document → config → project root), the first match wins.
 * 3. `resolvePath`: no search; tokens expanded, then a relative path is joined onto one base folder
 *    (project root, else config folder, else the document's folder). `pagemd validate` uses it (OQ-10).
 */

import { fsOp, loggerOf } from './ports.js';
import { pathOf, resolveFrom } from './path.js';
import { expandTokens } from './tokens.js';

/** Extension inference per resource type */
export const RESOURCE_EXTENSIONS = {
  profiles: ['.json', '.yaml', '.yml'],
  templates: ['.html', '.htm'],
  layouts: ['.css'],
  styles: ['.css'],
  assets: [] // No inference, require exact name
};

/** Known subfolders searched per resource type (only styles has any) */
export const RESOURCE_SUBDIRS = {
  styles: ['presets', 'syntax', 'vendor'],
  layouts: [],
  templates: [],
  profiles: [],
  assets: []
};

/**
 * The folders the search looks in, in order, without duplicates. No file access.
 * @param {string} resourceType - 'profiles' | 'templates' | 'layouts' | 'styles'
 * @param {object} context - workingPath, workspacePath, manifestPath, sharedProfilesPath, homePath, cliPath, sourceType
 * @param {import('./ports.js').Ports} [ports] - `env.homePath` and `env.sharedProfilesPath` when the context has
 *   none; `env.path`
 * @returns {string[]}
 */
export function buildSearchPaths(resourceType, context, ports = {}) {
  const P = pathOf(ports.env);
  const paths = [];
  const seen = new Set();

  function addPath(p) {
    const normalized = P.normalize(p);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      paths.push(normalized);
    }
  }

  // ./, ./{type}/, ./.pagemd/{type}/ (+ style subfolders)
  function addLocationPaths(basePath) {
    addPath(basePath);
    addPath(P.join(basePath, resourceType));
    addPath(P.join(basePath, '.pagemd', resourceType));
    for (const subdir of RESOURCE_SUBDIRS[resourceType] || []) {
      addPath(P.join(basePath, resourceType, subdir));
      addPath(P.join(basePath, '.pagemd', resourceType, subdir));
    }
  }

  // 1. The document's folder
  if (context.workingPath) {
    addLocationPaths(context.workingPath);
  }

  // 2. The profile's folder, only for paths that came from a profile
  if (context.sourceType === 'profile' && context.manifestPath) {
    addLocationPaths(context.manifestPath);
  }

  // 3. The workspace root
  if (context.workspacePath) {
    addLocationPaths(context.workspacePath);
  }

  // 4. Profiles only: the shared profiles folder (profile packs), the folder itself only
  if (resourceType === 'profiles') {
    const sharedPath = context.sharedProfilesPath || ports.env?.sharedProfilesPath;
    if (sharedPath) addPath(sharedPath);
  }

  // 5. Home: only ~/.pagemd/{type}/ (+ style subfolders), never the home folder itself
  const homePath = context.homePath || ports.env?.homePath;
  if (homePath) {
    addPath(P.join(homePath, '.pagemd', resourceType));
    for (const subdir of RESOURCE_SUBDIRS[resourceType] || []) {
      addPath(P.join(homePath, '.pagemd', resourceType, subdir));
    }
  }

  // 6. Bundled defaults: only {type}/ (+ style subfolders)
  if (context.cliPath) {
    addPath(P.join(context.cliPath, resourceType));
    for (const subdir of RESOURCE_SUBDIRS[resourceType] || []) {
      addPath(P.join(context.cliPath, resourceType, subdir));
    }
  }

  loggerOf(ports, 'io').trace('path-resolver', 'success', `Built search paths for ${resourceType}`, {
    resourceType,
    pathCount: paths.length,
    paths
  });

  return paths;
}

/**
 * Is `path` a file? (L2-2: a folder is never a match.) A FileSystem port without `stat` falls back to
 * `exists`, as before L2.
 * @returns {Generator<object, boolean>}
 */
export function* isFileGen(path) {
  let stat;
  try {
    stat = yield fsOp.stat(path);
  } catch (error) {
    if (/has no stat\(\)/.test(error?.message ?? '')) return Boolean(yield fsOp.exists(path));
    return false;
  }
  return Boolean(stat && stat.isFile);
}

/**
 * Look for a name in every search folder (with extension inference) and report duplicates. Only files
 * match (L2-2): `<folder>/<name>` that is a folder is skipped and the extensions are tried.
 * @returns {Generator<object, { found: string|null, duplicates: string[] }>}
 */
export function* findResourceWithDuplicateCheckGen(resourceName, searchPaths, resourceType, ports = {}) {
  const P = pathOf(ports.env);
  const logger = loggerOf(ports, 'io');
  const found = [];

  for (const dir of searchPaths) {
    const exactPath = P.join(dir, resourceName);
    if (yield* isFileGen(exactPath)) {
      found.push(exactPath);
      continue; // an exact match: next folder
    }

    if (!P.extname(resourceName)) {
      for (const ext of RESOURCE_EXTENSIONS[resourceType] || []) {
        const withExt = P.join(dir, resourceName + ext);
        if (yield* isFileGen(withExt)) {
          found.push(withExt);
          break; // one match per folder
        }
      }
    }
  }

  if (found.length === 0) {
    logger.debug('path-resolver', 'failure', `Resource not found: ${resourceName}`, {
      resourceName,
      resourceType,
      searchedPaths: searchPaths
    });
    return { found: null, duplicates: [] };
  }

  if (found.length > 1) {
    logger.warn('path-resolver', 'failure', `Duplicate resources detected: ${resourceName}`, {
      resourceName,
      resourceType,
      duplicates: found
    });
    return { found: null, duplicates: found };
  }

  logger.debug('path-resolver', 'success', `Resolved resource: ${resourceName}`, {
    resourceName,
    resourceType,
    resolvedPath: found[0]
  });
  return { found: found[0], duplicates: [] };
}

/**
 * Lookup 1: the 5-tier search, 6 tiers for profiles (see the file header).
 * @returns {Generator<object, { resolvedPath: string, searchedPaths: string[] }>}
 * @throws {Error} not found (`error.searchedPaths`) or found more than once (`error.duplicates`)
 */
export function* resolveResourceGen(resourceName, resourceType, context, ports = {}) {
  const P = pathOf(ports.env);
  const logger = loggerOf(ports, 'io');

  logger.trace('path-resolver', 'in-progress', `Resolving resource: ${resourceName}`, {
    resourceName,
    resourceType,
    sourceType: context.sourceType
  });

  // Absolute: used as it is
  if (P.isAbsolute(resourceName)) {
    if (!(yield fsOp.exists(resourceName))) {
      const error = new Error(`Absolute path not found: ${resourceName}`);
      logger.error('path-resolver', 'failure', 'Absolute resource path not found', {
        resourceName,
        resourceType
      });
      throw error;
    }
    logger.debug('path-resolver', 'success', 'Resolved absolute resource path', {
      resourceName,
      resolvedPath: resourceName
    });
    return { resolvedPath: resourceName, searchedPaths: [] };
  }

  // ./ and ../: from the profile's folder, else the document's, else the workspace (no search)
  if (resourceName.startsWith('./') || resourceName.startsWith('../')) {
    const baseDir = context.manifestPath || context.workingPath || context.workspacePath;
    if (!baseDir) {
      const error = new Error('No base directory available for relative path resolution');
      logger.error('path-resolver', 'failure', 'No base directory in context', {
        resourceName,
        resourceType,
        context
      });
      throw error;
    }
    const resolved = resolveFrom(ports.env, baseDir, resourceName);
    if (!(yield fsOp.exists(resolved))) {
      const error = new Error(`Relative path not found: ${resourceName} (resolved to ${resolved})`);
      logger.error('path-resolver', 'failure', 'Relative resource path not found', {
        resourceName,
        resolvedPath: resolved,
        baseDir
      });
      throw error;
    }
    logger.debug('path-resolver', 'success', 'Resolved relative resource path', {
      resourceName,
      resolvedPath: resolved,
      baseDir
    });
    return { resolvedPath: resolved, searchedPaths: [] };
  }

  // Search every tier, with duplicate detection
  const searchPaths = buildSearchPaths(resourceType, context, ports);
  const { found, duplicates } = yield* findResourceWithDuplicateCheckGen(resourceName, searchPaths, resourceType, ports);

  if (duplicates.length > 0) {
    const error = new Error(
      `Duplicate resources found for "${resourceName}":\n` +
      duplicates.map((p, i) => `  ${i + 1}. ${p}`).join('\n') +
      '\n\nPlease use unique names or specify an absolute path.'
    );
    error.duplicates = duplicates;
    logger.error('path-resolver', 'failure', 'Duplicate resources detected', {
      resourceName,
      resourceType,
      duplicates
    });
    throw error;
  }

  if (!found) {
    const error = new Error(
      `Resource not found: ${resourceName}\n` +
      `Searched in:\n` +
      searchPaths.map((p, i) => `  ${i + 1}. ${p}`).join('\n')
    );
    error.searchedPaths = searchPaths;
    logger.error('path-resolver', 'failure', 'Resource not found in any location', {
      resourceName,
      resourceType,
      searchedPaths: searchPaths
    });
    throw error;
  }

  logger.debug('path-resolver', 'success', 'Resolved resource via search', {
    resourceName,
    resourceType,
    resolvedPath: found,
    searchedPathCount: searchPaths.length
  });

  return { resolvedPath: found, searchedPaths: searchPaths };
}

/**
 * Lookup 2: three folders (document → config → project root); the first that has the file wins.
 * In pagemd only theme-kit's `resolveFontPath`/`resolveAssetPath` use it, and nothing calls those.
 * @returns {Generator<object, string>}
 */
export function* resolveResourcePathGen(relativePath, context, ports = {}) {
  const logger = loggerOf(ports, 'io');
  const P = pathOf(ports.env);
  const searchDirs = [context.markdownDir, context.configDir, context.projectRoot].filter(Boolean);

  if (searchDirs.length === 0) {
    const error = new Error('No search directories available in context');
    logger.error('path-resolver', 'failure', 'Empty context for resource resolution', { relativePath });
    throw error;
  }

  logger.trace('path-resolver', 'in-progress', `Resolving resource: ${relativePath}`, { searchDirs });

  for (const dir of searchDirs) {
    const candidate = resolveFrom(ports.env, dir, relativePath);
    try {
      if (yield fsOp.exists(candidate)) {
        logger.debug('path-resolver', 'success', `Resolved resource in ${P.basename(dir)}`, {
          relativePath,
          resolvedPath: candidate,
          searchDir: dir
        });
        return candidate;
      }
    } catch (err) {
      logger.trace('path-resolver', 'failure', `Access check failed for ${candidate}`, {
        error: err.message
      });
    }
  }

  const error = new Error(`Resource not found: ${relativePath}`);
  error.searchedPaths = searchDirs.map((dir) => resolveFrom(ports.env, dir, relativePath));
  logger.error('path-resolver', 'failure', 'Resource not found in any location', {
    relativePath,
    searchedPaths: error.searchedPaths
  });
  throw error;
}

/**
 * Lookup 3: no search. Tokens expanded; an absolute result is normalized; a relative one is joined
 * onto the project root, else the config folder, else the document's folder. No file access.
 * @returns {string}
 */
export function resolvePath(pathString, context, ports = {}) {
  const logger = loggerOf(ports, 'io');
  const P = pathOf(ports.env);

  if (!pathString) {
    const error = new Error('Cannot resolve empty path');
    logger.error('path-resolver', 'failure', 'Empty path string provided');
    throw error;
  }

  const expanded = expandTokens(pathString, context, ports);

  // Normalizing also fixes mixed separators from token expansion
  if (P.isAbsolute(expanded)) {
    const normalized = P.normalize(expanded);
    logger.debug('path-resolver', 'success', 'Resolved absolute path', {
      original: pathString,
      resolved: normalized
    });
    return normalized;
  }

  const baseDir = context.projectRoot || context.configDir || context.markdownDir;
  if (!baseDir) {
    const error = new Error('No base directory available in context for path resolution');
    logger.error('path-resolver', 'failure', 'No base directory in context', {
      pathString,
      context
    });
    throw error;
  }

  const resolved = resolveFrom(ports.env, baseDir, expanded);
  logger.debug('path-resolver', 'success', 'Resolved relative path', {
    original: pathString,
    expanded,
    resolved,
    baseDir
  });

  return resolved;
}
