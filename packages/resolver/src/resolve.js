/**
 * resolveDocument(): one answer to "given this .md file, what are its project root, profile,
 * template and stylesheets?" (phase C4). pagemd's renderer and the editor both use it.
 *
 * Only the profile has to be found for an answer: when it can't be, this throws (as pagemd always
 * has). A template or stylesheet that can't be found doesn't stop it: the entry carries its `error`,
 * and `problems` lists them all, so the editor can show every problem at once and pagemd can throw
 * each one at the step where it always has, with the same message.
 */

import { layer } from '@pagemd/meta';
import { loggerOf } from './ports.js';
import { pathOf } from './path.js';
import { createPathContext } from './tokens.js';
import { findProjectRootGen } from './discover.js';
import { getDefaultProfile, loadAndMergeProfileGen, loadProfileGen, profileSourcePath } from './profile.js';
import { resourceFolder } from './profile.js';
import { profileResourceKeys, profileStylesheets, resolveStylesheetGen, resolveTemplateGen, systemStylesheets, templateSource, withManifestFolder } from './template.js';

/**
 * @typedef {object} ResolvedFile
 * @property {string} source - the path as written (tokens not expanded)
 * @property {string} [path] - where it was found
 * @property {Error} [error] - why it wasn't (`error.stage`: 'tokens' | 'search' for stylesheets)
 * @property {boolean} [skipped] - a profile CSS entry the system layers already hold (base/primary)
 *
 * @typedef {object} ResolvedDocument
 * @property {string|null} markdownPath
 * @property {string|null} markdownDir
 * @property {string|null} projectRoot
 * @property {string|null} cliPath - the bundled defaults folder used
 * @property {string} profileId - the profile asked for (frontmatter `profile`, else the option, else the default)
 * @property {object} profile - the merged profile (`_manifestDir` = the named profile's folder)
 * @property {Array<{ id: string, path: string|null }>} profileChain - the named profile, then each `extends`
 * @property {object} pathContext - for token expansion
 * @property {object} metadata - properties layered as pagemd does: built-in → profile defaults → frontmatter → overrides
 * @property {ResolvedFile & { usedDefault: boolean }} template
 * @property {ResolvedFile|null} layout - null when the profile names no layout
 * @property {ResolvedFile[]} styles - the profile's CSS, in order
 * @property {boolean} legacyStyles - the styles came from the legacy `styles.profile`
 * @property {ResolvedFile[]} frontmatterStyles - the `styles:` property's files, in order
 * @property {{ base: string|null, primary: string|null, syntax: string|null }} system - bundled system CSS
 * @property {string[]} sources - every file this answer depends on (profiles, template, stylesheets)
 * @property {Array<{ kind: string, source: string, message: string }>} problems
 */

/**
 * @param {string|null} markdownPath - the document (null for text without a file)
 * @param {object} [options]
 * @param {object} [options.frontmatter] - what the author wrote, normalized (pagemd's `writtenMetadata`)
 * @param {object} [options.metadata] - overrides layered last (pagemd's `renderMarkdown` option)
 * @param {string} [options.profile] - the profile when the frontmatter names none (the CLI's `-p`)
 * @param {string|null} [options.projectRoot] - skips the project-root search when given (even null)
 * @param {string|null} [options.cliPath] - bundled defaults; default `env.defaultsPath`
 * @param {import('./ports.js').Ports} ports
 * @returns {Generator<object, ResolvedDocument>}
 */
export function* resolveDocumentGen(markdownPath, options = {}, ports = {}) {
  const P = pathOf(ports.env);
  const logger = loggerOf(ports, 'io');
  const frontmatter = options.frontmatter || {};
  const cliPath = options.cliPath !== undefined ? options.cliPath : (ports.env?.defaultsPath ?? null);

  const projectRoot = options.projectRoot !== undefined
    ? options.projectRoot
    : yield* findProjectRootGen(markdownPath || ports.env?.cwd, ports);

  // The frontmatter's profile wins over the option (pagemd: frontmatter > -p > default)
  let profileId = frontmatter.pipeline_profile || options.profile;
  if (profileId === undefined) profileId = getDefaultProfile();

  const markdownDir = markdownPath ? P.dirname(markdownPath) : null;
  const where = { searchFrom: markdownDir || projectRoot, configDir: projectRoot, cliPath };

  const profile = yield* loadAndMergeProfileGen(profileId, where, ports);
  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`);
  }

  // The chain of files (all cached when the caller shares a cache)
  const profileChain = [];
  const seen = new Set();
  let name = profileId; // may be empty: the default profile is loaded then
  do {
    seen.add(name);
    const one = yield* loadProfileGen(name, { ...where, variant: 'sync' }, ports);
    profileChain.push({ id: one?.id ?? name, path: profileSourcePath(one) });
    name = one?.extends;
  } while (name && !seen.has(name));

  const pathContext = createPathContext({
    markdownDir,
    projectRoot,
    manifestDir: profile._manifestDir,
    cliPath
  }, ports);

  const problems = [];
  const note = (kind, entry) => {
    if (entry.error) problems.push({ kind, source: entry.source, message: entry.error.message });
    return entry;
  };

  // Template
  let template;
  try {
    template = yield* resolveTemplateGen(profile, pathContext, { cliPath }, ports);
  } catch (error) {
    template = { ...templateSource(profile), error };
  }
  note('template', template);

  // Properties, layered as pagemd does, for the `styles:` list
  const metadata = layer(profile.metadata?.defaults, frontmatter, options.metadata);

  const frontmatterStyles = [];
  if (Array.isArray(metadata.styles) && metadata.styles.length > 0) {
    for (const source of metadata.styles) {
      try {
        frontmatterStyles.push({ source, path: yield* resolveStylesheetGen(source, pathContext, 'frontmatter', ports) });
      } catch (error) {
        frontmatterStyles.push(note('frontmatter-style', { source, error }));
      }
    }
  }

  // The profile's layout and CSS. Each is looked up from the folder of the profile in the `extends` chain that
  // named it (R-136): its `./`, `../`, `${manifestPath}` and the search's profile-folder tier
  const named = profileStylesheets(profile);
  const keys = profileResourceKeys(profile);
  const layoutContext = withManifestFolder(pathContext, keys.layout && resourceFolder(profile, keys.layout));
  const stylesContext = withManifestFolder(pathContext, keys.styles && resourceFolder(profile, keys.styles));
  let layout = null;
  if (named.layout) {
    try {
      layout = { source: named.layout, path: yield* resolveStylesheetGen(named.layout, layoutContext, 'profile', ports) };
    } catch (error) {
      layout = note('layout', { source: named.layout, error });
    }
  }

  const styles = [];
  for (const { source, skipped } of named.styles) {
    if (skipped) {
      styles.push({ source, skipped: true });
      continue;
    }
    try {
      styles.push({ source, path: yield* resolveStylesheetGen(source, stylesContext, 'profile', ports) });
    } catch (error) {
      styles.push(note('style', { source, error }));
    }
  }

  const system = systemStylesheets(cliPath, ports);

  const sources = [
    ...profileChain.map((p) => p.path),
    template.path,
    layout?.path,
    ...styles.map((s) => s.path),
    ...frontmatterStyles.map((s) => s.path),
    system.base,
    system.primary,
    system.syntax
  ].filter((p, i, all) => p && all.indexOf(p) === i);

  logger.debug('path-resolver', 'success', 'Resolved document', {
    markdownPath,
    profile: profileId,
    problems: problems.length
  });

  return {
    markdownPath: markdownPath || null,
    markdownDir,
    projectRoot,
    cliPath,
    profileId,
    profile,
    profileChain,
    pathContext,
    metadata,
    template,
    layout,
    styles,
    legacyStyles: named.legacy,
    frontmatterStyles,
    system,
    sources,
    problems
  };
}

