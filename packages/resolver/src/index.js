/**
 * @pagemd/resolver: finding a pagemd document's files, in pagemd's order (phase C4).
 *
 * Every function that reads files comes twice, from one copy of the logic: `name()` returns a
 * Promise and accepts a FileSystem whose methods may return Promises (the editor, VS Code);
 * `nameSync()` needs a synchronous FileSystem (pagemd's CLI). The ports (`{ fs, env, log, cache }`,
 * see ports.js) are always the last argument. Functions without file access have one form.
 */

import { twins } from './ports.js';
import { findResourceWithDuplicateCheckGen, resolveResourceGen, resolveResourcePathGen } from './search.js';
import { discoverResourcesGen, findProjectRootGen } from './discover.js';
import { detectCircularInheritanceGen, loadAndMergeProfileGen, loadProfileGen } from './profile.js';
import { resolveStylesheetGen, resolveTemplateGen } from './template.js';
import { resolveDocumentGen } from './resolve.js';
import { rebaseAssetPathsGen } from './asset-paths.js';
import { listProfilesGen } from './list-profiles.js';

export { fsOp, runSync, runAsync, runPure, twins } from './ports.js';
export { posix, pathOf } from './path.js';
export { createPathContext, expandTokens } from './tokens.js';
export { RESOURCE_PATHS, DEFAULT_FILES, getResourcePath } from './paths.js';
export {
  RESOURCE_EXTENSIONS,
  RESOURCE_SUBDIRS,
  buildSearchPaths,
  resolvePath,
  findResourceWithDuplicateCheckGen,
  isFileGen,
  resolveResourceGen,
  resolveResourcePathGen
} from './search.js';
export { sharedProfilesFolder, sharedProfilesFolderInfo, SHARED_FOLDER_REASONS } from './shared-folder.js';
export { PROFILE_TIERS, profileListFolders, listProfilesGen } from './list-profiles.js';
export {
  PROJECT_ROOT_MARKERS,
  RESOURCE_TYPES,
  getResourceDirectories,
  findProjectRootGen,
  discoverResourcesGen,
  scanResourceFolderGen
} from './discover.js';
export {
  getDefaultProfile,
  mergeProfiles,
  validateProfile,
  isProfilePath,
  profileSourcePath,
  RESOURCE_KEYS,
  resourceFolder,
  loadProfileGen,
  detectCircularInheritanceGen,
  loadAndMergeProfileGen
} from './profile.js';
export {
  DEFAULT_TEMPLATE_PATH,
  templateSource,
  profileStylesheets,
  profileResourceKeys,
  withManifestFolder,
  systemStylesheets,
  resolveTemplateGen,
  resolveStylesheetGen
} from './template.js';
export { resolveDocumentGen } from './resolve.js';
export { scanHtml, scanCss, relativeAssetPath, documentRelativeUrl, rebaseAssetPathsGen } from './asset-paths.js';
export { loadYaml, LEGACY_SCHEMA } from './yaml.js';
export { createMemoryFileSystem } from './memory-fs.js';

/** The project root: the nearest folder upwards with package.json, .git or .pagemdrc (or null). */
export const [findProjectRoot, findProjectRootSync] = twins(findProjectRootGen);

/** Lookup 1, the 5-tier search (6 tiers for profiles, L2) → `{ resolvedPath, searchedPaths }`. */
export const [resolveResource, resolveResourceSync] = twins(resolveResourceGen);

/** One name in a list of folders → `{ found, duplicates }`. */
export const [findResourceWithDuplicateCheck, findResourceWithDuplicateCheckSync] = twins(findResourceWithDuplicateCheckGen);

/** Lookup 2, three folders, first wins → path. */
export const [resolveResourcePath, resolveResourcePathSync] = twins(resolveResourcePathGen);

/** Lookup 7, `pagemd list`'s listing → resources sorted by name. */
export const [discoverResources, discoverResourcesSync] = twins(discoverResourcesGen);

/**
 * Every profile a document can name, from every folder the search uses, duplicates reported (L2-7) →
 * `ProfileEntry[]` (see list-profiles.js). `where = { documentPath, projectRoot, cliPath }`.
 */
export const [listProfiles, listProfilesSync] = twins(listProfilesGen);

/** One profile, no inheritance → profile or null. `where = { searchFrom, configDir, cliPath, variant }`. */
export const [loadProfile, loadProfileSync] = twins(loadProfileGen);

/** A profile with its `extends` chain merged. */
export const [loadAndMergeProfile, loadAndMergeProfileSync] = twins(loadAndMergeProfileGen);

/** Throws on an `extends` cycle; `loadGen(name)` must be a generator function (see profile.js). */
export const [detectCircularInheritance, detectCircularInheritanceSync] = twins(detectCircularInheritanceGen);

/** A profile's template → `{ source, usedDefault, path }`. */
export const [resolveTemplate, resolveTemplateSync] = twins(resolveTemplateGen);

/** One stylesheet → path. */
export const [resolveStylesheet, resolveStylesheetSync] = twins(resolveStylesheetGen);

/** Everything about one document (see resolve.js). */
export const [resolveDocument, resolveDocumentSync] = twins(resolveDocumentGen);

/**
 * A template's or stylesheet's relative paths, started from that file's folder and written relative to the document
 * (FIX-template-asset-paths, R-259) → `{ text, assets }`.
 */
export const [rebaseAssetPaths, rebaseAssetPathsSync] = twins(rebaseAssetPathsGen);
