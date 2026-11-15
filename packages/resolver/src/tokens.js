/**
 * Path tokens and the path context (from pagemd `core/src/path-resolver.js`, phase C4).
 *
 * Canonical tokens: ${workingPath} (the document's folder), ${workspacePath} (project root),
 * ${manifestPath} (the profile's folder), ${homePath}, ${cliPath} (bundled defaults).
 * Legacy aliases: ${markdownDir} = workingPath, ${projectRoot} and ${workspaceFolder} = workspacePath,
 * ${manifestDir} = manifestPath.
 */

import { loggerOf } from './ports.js';

/**
 * Create a path context with both canonical and legacy names.
 * @param {object} options - workingPath, workspacePath, manifestPath, homePath, cliPath, or the legacy
 *   markdownDir, projectRoot, manifestDir, workspaceFolder, configDir
 * @param {import('./ports.js').Ports} [ports] - `env.homePath` fills a missing homePath
 * @returns {object}
 */
export function createPathContext(options = {}, ports = {}) {
  const {
    workingPath,
    workspacePath,
    manifestPath,
    homePath,
    cliPath,
    markdownDir,
    projectRoot,
    manifestDir,
    workspaceFolder,
    configDir
  } = options;

  // Prefer canonical names, fall back to legacy ones
  const resolvedWorkingPath = workingPath || markdownDir || null;
  const resolvedWorkspacePath = workspacePath || projectRoot || workspaceFolder || null;
  const resolvedManifestPath = manifestPath || manifestDir || null;
  const resolvedHomePath = homePath || ports.env?.homePath;
  const resolvedCliPath = cliPath || null;
  const resolvedConfigDir = configDir || null; // kept separate for backward compatibility

  // Explicit legacy values are preserved; otherwise they alias the canonical ones
  const context = {
    workingPath: resolvedWorkingPath,
    workspacePath: resolvedWorkspacePath,
    manifestPath: resolvedManifestPath,
    homePath: resolvedHomePath,
    cliPath: resolvedCliPath,
    markdownDir: markdownDir ?? resolvedWorkingPath,
    projectRoot: projectRoot ?? resolvedWorkspacePath,
    manifestDir: manifestDir ?? resolvedManifestPath,
    workspaceFolder: workspaceFolder ?? resolvedWorkspacePath,
    configDir: resolvedConfigDir
  };

  loggerOf(ports, 'io').trace('path-resolver', 'success', 'Created path context', context);
  return context;
}

const LEGACY_SUGGESTION = {
  markdownDir: 'workingPath',
  projectRoot: 'workspacePath',
  manifestDir: 'manifestPath',
  workspaceFolder: 'workspacePath'
};

/**
 * Expand ${token} variables in a path string.
 * @param {string} pathString
 * @param {object} context - a path context
 * @param {import('./ports.js').Ports} [ports]
 * @returns {string}
 * @throws {Error} when a token is used but has no value in the context
 */
export function expandTokens(pathString, context, ports = {}) {
  if (!pathString) return pathString;
  const logger = loggerOf(ports, 'io');

  const tokenMap = {
    workingPath: context.workingPath,
    workspacePath: context.workspacePath,
    manifestPath: context.manifestPath,
    homePath: context.homePath,
    cliPath: context.cliPath,
    markdownDir: context.markdownDir,
    projectRoot: context.projectRoot,
    manifestDir: context.manifestDir,
    workspaceFolder: context.workspaceFolder
  };

  let expanded = pathString;
  let hadTokens = false;

  for (const [token, value] of Object.entries(tokenMap)) {
    const pattern = new RegExp(`\\$\\{${token}\\}`, 'g');
    if (pattern.test(expanded)) {
      hadTokens = true;
      if (!value) {
        const canonical = LEGACY_SUGGESTION[token];
        const suggestion = canonical ? ` (consider using \${${canonical}} instead)` : '';
        const error = new Error(`Token \${${token}} used but not defined in context${suggestion}`);
        logger.error('path-resolver', 'failure', `Undefined token: \${${token}}`, { pathString });
        throw error;
      }
      expanded = expanded.replace(pattern, value);
    }
  }

  if (hadTokens) {
    logger.debug('path-resolver', 'success', 'Expanded path tokens', {
      original: pathString,
      expanded
    });
  }

  return expanded;
}
