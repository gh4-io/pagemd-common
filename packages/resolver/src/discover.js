/**
 * The project root and resource listings (from pagemd `core/src/path-resolver.js` and
 * `core/src/resource-discovery.js`, phase C4).
 *
 * `discoverResources` is a separate lookup (7 in the C4 side-by-side): it lists the bundled folder
 * and, when asked, `.pagemd/`; a name in both is taken from `.pagemd/` (the later one wins). Used by
 * `pagemd list` and `pagemd create`. Not unified with the 5-tier search.
 */

import { fsOp, loggerOf } from './ports.js';
import { pathOf, resolveFrom } from './path.js';
import { RESOURCE_PATHS } from './paths.js';
import { loadYaml } from './yaml.js';

/** The marker files that make a folder the project root. */
export const PROJECT_ROOT_MARKERS = ['package.json', '.git', '.pagemdrc'];

/**
 * Walk up from a folder to the first one holding a marker (`package.json`, `.git`, `.pagemdrc`).
 * The file-system root itself is never checked (as in pagemd).
 * @returns {Generator<object, string|null>}
 */
export function* findProjectRootGen(startDir, ports = {}) {
  const P = pathOf(ports.env);
  const logger = loggerOf(ports, 'io');
  let currentDir = resolveFrom(ports.env, startDir);
  const rootDir = P.parse(currentDir).root;

  logger.trace('path-resolver', 'in-progress', `Searching for project root from ${startDir}`);

  while (currentDir !== rootDir) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      const markerPath = P.join(currentDir, marker);
      let stat = null;
      try {
        stat = yield fsOp.stat(markerPath);
      } catch {
        stat = null; // marker not readable: continue
      }
      if (stat && (stat.isFile || (marker === '.git' && stat.isDirectory))) {
        logger.debug('path-resolver', 'success', `Found project root via ${marker}`, {
          projectRoot: currentDir,
          marker: markerPath
        });
        return currentDir;
      }
    }

    const parentDir = P.dirname(currentDir);
    if (parentDir === currentDir) break; // reached the file-system root
    currentDir = parentDir;
  }

  logger.warn('path-resolver', 'failure', 'No project root found', { startDir });
  return null;
}

/** File extensions listed per resource type (discovery's own list: templates are `.html` only) */
const DISCOVERY_EXTENSIONS = {
  profiles: ['.json', '.yaml', '.yml'],
  templates: ['.html'],
  layouts: ['.css'],
  styles: ['.css']
};

/** Valid resource types */
export const RESOURCE_TYPES = Object.keys(RESOURCE_PATHS);

function* loadResourceContentGen(filePath, ports, logger) {
  const P = pathOf(ports.env);
  const ext = P.extname(filePath).toLowerCase();
  if (!['.json', '.yaml', '.yml'].includes(ext)) {
    return null;
  }
  try {
    const content = yield fsOp.readText(filePath);
    return ext === '.json' ? JSON.parse(content) : loadYaml(content);
  } catch (err) {
    logger.warn('load', 'failure', 'Failed to parse resource', {
      file: filePath,
      error: err.message
    });
    return null;
  }
}

/**
 * The resources of one type in one folder (files only, the type's extensions), with a profile's id, description and
 * content read. A missing or unreadable folder gives []. Used by `discoverResources` and `listProfiles` (L2-7).
 * @returns {Generator<object, object[]>}
 */
export function* scanResourceFolderGen(dirPath, type, source, ports = {}) {
  return yield* scanDirectoryGen(dirPath, type, source, ports, loggerOf(ports, 'discovery'));
}

function* scanDirectoryGen(dirPath, type, source, ports, logger) {
  const P = pathOf(ports.env);
  if (!(yield fsOp.exists(dirPath))) {
    logger.trace('scan', 'skip', 'Directory does not exist', { dir: dirPath });
    return [];
  }

  const extensions = DISCOVERY_EXTENSIONS[type];
  if (!extensions) {
    logger.warn('scan', 'skip', 'Unknown resource type', { type });
    return [];
  }

  logger.debug('scan', 'in-progress', 'Scanning directory', { dir: dirPath, type });

  const resources = [];
  try {
    const files = yield fsOp.list(dirPath);

    for (const file of files) {
      const ext = P.extname(file).toLowerCase();
      if (!extensions.includes(ext)) {
        continue;
      }

      const filePath = P.join(dirPath, file);

      // Skip folders and anything that can't be read
      let stats;
      try {
        stats = yield fsOp.stat(filePath);
      } catch {
        stats = null;
      }
      if (!stats || stats.isDirectory) {
        continue;
      }

      const name = P.basename(file, ext);
      const resource = {
        name,
        path: filePath,
        source,
        size: stats.size,
        extension: ext
      };

      if (type === 'profiles') {
        const content = yield* loadResourceContentGen(filePath, ports, logger);
        if (content) {
          resource.id = content.id || name;
          resource.description = content.description || null;
          resource.extends = content.extends || null;
          resource.content = content;
          if (content.id && content.id !== name) {
            logger.warn('scan', 'mismatch', 'Profile ID does not match filename', {
              file,
              profileId: content.id,
              filename: name
            });
          }
        } else {
          resource.id = name;
          resource.description = null;
          resource.extends = null;
          resource.content = null;
        }
      }

      resources.push(resource);
    }
  } catch (err) {
    logger.error('scan', 'failure', 'Failed to scan directory', {
      dir: dirPath,
      error: err.message
    });
    return [];
  }

  logger.debug('scan', 'success', 'Directory scanned', {
    dir: dirPath,
    count: resources.length
  });

  return resources;
}

/**
 * List the resources of one type: `{root}/{type}/`, then (with `includeWorkspace`)
 * `{root}/.pagemd/{type}/`, whose entries replace same-named ones. Sorted by name.
 * @returns {Generator<object, object[]>}
 */
export function* discoverResourcesGen(type, projectRoot, options = {}, ports = {}) {
  const { includeWorkspace = false } = options;
  const P = pathOf(ports.env);
  const logger = loggerOf(ports, 'discovery');

  if (!RESOURCE_TYPES.includes(type)) {
    throw new Error(
      `Unknown resource type: '${type}'. Valid types: ${RESOURCE_TYPES.join(', ')}`
    );
  }

  logger.info('discover', 'in-progress', 'Discovering resources', {
    type,
    projectRoot,
    includeWorkspace
  });

  const resourceMap = new Map(); // by name; the workspace replaces the project

  const projectDir = P.join(projectRoot, RESOURCE_PATHS[type]);
  const projectResources = yield* scanDirectoryGen(projectDir, type, 'project', ports, logger);
  for (const resource of projectResources) {
    resourceMap.set(resource.name, resource);
  }

  if (includeWorkspace) {
    const workspaceDir = P.join(projectRoot, '.pagemd', RESOURCE_PATHS[type]);
    const workspaceResources = yield* scanDirectoryGen(workspaceDir, type, 'workspace', ports, logger);
    for (const resource of workspaceResources) {
      resourceMap.set(resource.name, resource);
    }
  }

  const resources = Array.from(resourceMap.values());
  resources.sort((a, b) => a.name.localeCompare(b.name));

  logger.info('discover', 'success', 'Resources discovered', {
    type,
    total: resources.length,
    project: projectResources.length,
    workspace: includeWorkspace ? resources.length - projectResources.length : 0
  });

  return resources;
}

/**
 * The two folders `discoverResources` lists. No file access.
 * @returns {{ project: string, workspace: string }}
 */
export function getResourceDirectories(type, projectRoot, ports = {}) {
  const P = pathOf(ports.env);
  if (!RESOURCE_TYPES.includes(type)) {
    throw new Error(
      `Unknown resource type: '${type}'. Valid types: ${RESOURCE_TYPES.join(', ')}`
    );
  }
  return {
    project: P.join(projectRoot, RESOURCE_PATHS[type]),
    workspace: P.join(projectRoot, '.pagemd', RESOURCE_PATHS[type])
  };
}
