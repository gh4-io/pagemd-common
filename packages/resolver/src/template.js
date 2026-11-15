/**
 * Finding a profile's template and stylesheets (from pagemd `renderer-web/src/template.js` and
 * `theme-kit/src/index.js`, phase C4). Only the *lookup* is here; reading and using the files stays
 * with the caller.
 */

import { pathOf } from './path.js';
import { expandTokens } from './tokens.js';
import { resolveResourceGen } from './search.js';
import { DEFAULT_FILES } from './paths.js';
import { resourceFolder } from './profile.js';

/**
 * The template used when a profile names none (lookup 6 in the C4 side-by-side). `${projectRoot}`
 * is the *workspace* root, so this is `<workspace>/templates/standard_letter.html`, not pagemd's
 * bundled copy (the standard_letter profile itself names `${cliPath}/templates/…`). Kept as the
 * code has it; an open question in the project's design record.
 */
export const DEFAULT_TEMPLATE_PATH = '${projectRoot}/templates/standard_letter.html';

/**
 * The template a profile asks for: `resources.template`, else the legacy `layout.source`, else
 * DEFAULT_TEMPLATE_PATH.
 * @returns {{ source: string, usedDefault: boolean }}
 */
export function templateSource(profile) {
  const named = profile?.resources?.template || profile?.layout?.source;
  return named ? { source: named, usedDefault: false } : { source: DEFAULT_TEMPLATE_PATH, usedDefault: true };
}

/**
 * Which keys (RESOURCE_KEYS in profile.js) a profile's template, layout and CSS come from, so their relative
 * paths can start from the folder of the profile that wrote them (resourceFolder, R-136). null: none named.
 * @returns {{ template: string|null, layout: string|null, styles: string|null }}
 */
export function profileResourceKeys(profile) {
  const template = profile?.resources?.template ? 'resources.template' : profile?.layout?.source ? 'layout.source' : null;
  const layout = profile?.resources?.layout ? 'resources.layout' : profile?.layout?.css ? 'layout.css' : null;
  const hasResourcesCss = Array.isArray(profile?.resources?.css) && profile.resources.css.length > 0;
  const styles = hasResourcesCss ? 'resources.css' : profile?.styles?.profile ? 'styles.profile' : null;
  return { template, layout, styles };
}

/**
 * A path context whose `${manifestPath}` (and profile-folder search tier) is `folder` (R-136); the same context
 * when `folder` is empty or already its own.
 */
export function withManifestFolder(pathContext, folder) {
  if (!folder || (pathContext.manifestPath === folder && pathContext.manifestDir === folder)) return pathContext;
  return { ...pathContext, manifestPath: folder, manifestDir: folder };
}

/**
 * Find a profile's template: tokens expanded, then the 5-tier search with `sourceType: 'profile'`
 * (so the profile's own folder is searched too). For a merged profile, "the profile's folder" is the folder
 * of the profile in the `extends` chain that named the template (R-136).
 * @param {object} profile - a loaded profile (its `_manifestDir` is the profile's folder)
 * @param {object} pathContext
 * @param {{ cliPath?: string|null }} [options]
 * @returns {Generator<object, { source: string, usedDefault: boolean, path: string }>}
 * @throws {Error} the lookup's own error (a token without a value, not found, duplicates)
 */
export function* resolveTemplateGen(profile, pathContext, options = {}, ports = {}) {
  const { source, usedDefault } = templateSource(profile);
  const key = profileResourceKeys(profile).template;
  const folder = (key && resourceFolder(profile, key)) || profile._manifestDir || pathContext.manifestDir;
  const templateContext = withManifestFolder(pathContext, folder);
  const expanded = expandTokens(source, templateContext, ports);
  const context = {
    workingPath: pathContext.markdownDir,
    workspacePath: pathContext.projectRoot || pathContext.workspaceFolder,
    manifestPath: folder,
    cliPath: options.cliPath || pathContext.cliPath,
    sourceType: 'profile'
  };
  const { resolvedPath } = yield* resolveResourceGen(expanded, 'templates', context, ports);
  return { source, usedDefault, path: resolvedPath };
}

/**
 * Find one stylesheet (a profile's layout or CSS, or a frontmatter `styles:` entry): tokens
 * expanded, then the 5-tier search.
 * @param {'profile'|'frontmatter'|'cli'} sourceType - 'profile' also searches the profile's folder
 * @returns {Generator<object, string>} the file's path
 * @throws {Error} the lookup's own error; `stage` says whether the tokens or the search failed
 */
export function* resolveStylesheetGen(cssPath, pathContext, sourceType = 'profile', ports = {}) {
  let expanded;
  try {
    expanded = expandTokens(cssPath, pathContext, ports);
  } catch (err) {
    err.stage = 'tokens';
    throw err;
  }
  const context = {
    workingPath: pathContext.markdownDir,
    workspacePath: pathContext.projectRoot || pathContext.workspaceFolder,
    manifestPath: pathContext.manifestDir,
    cliPath: pathContext.cliPath,
    sourceType
  };
  try {
    const { resolvedPath } = yield* resolveResourceGen(expanded, 'styles', context, ports);
    return resolvedPath;
  } catch (err) {
    err.stage = 'search';
    throw err;
  }
}

/**
 * Which stylesheets a profile names, in layer order, before any lookup:
 * - `layout`: `resources.layout`, else the legacy `layout.css` (null when neither);
 * - `styles`: `resources.css[]` (entries ending in base.css / primary.css are `skipped`: the system
 *   layers already hold them), else the legacy `styles.profile` (one path or a list).
 * @returns {{ layout: string|null, styles: Array<{ source: string, skipped: boolean }>, legacy: boolean }}
 */
export function profileStylesheets(profile) {
  const layout = profile?.resources?.layout || profile?.layout?.css || null;
  const hasResourcesCss = Array.isArray(profile?.resources?.css) && profile.resources.css.length > 0;
  if (hasResourcesCss) {
    return {
      layout,
      legacy: false,
      styles: profile.resources.css.map((source) => ({
        source,
        skipped: source.endsWith('/base.css') || source.endsWith('/primary.css') ||
          source === DEFAULT_FILES.baseCSS || source === DEFAULT_FILES.primaryCSS
      }))
    };
  }
  if (profile?.styles?.profile) {
    const list = Array.isArray(profile.styles.profile) ? profile.styles.profile : [profile.styles.profile];
    return { layout, legacy: true, styles: list.map((source) => ({ source, skipped: false })) };
  }
  return { layout, legacy: false, styles: [] };
}

/**
 * Where the bundled system stylesheets are: `<defaults>/styles/base.css`, `primary.css` and
 * `syntax/shiki-base.css`, read without a search (lookup 4). null when there is no defaults folder.
 */
export function systemStylesheets(cliPath, ports = {}) {
  if (!cliPath) return { base: null, primary: null, syntax: null };
  const P = pathOf(ports.env);
  return {
    base: P.join(cliPath, 'styles', DEFAULT_FILES.baseCSS),
    primary: P.join(cliPath, 'styles', DEFAULT_FILES.primaryCSS),
    syntax: P.join(cliPath, 'styles', 'syntax', DEFAULT_FILES.syntaxCSS)
  };
}
