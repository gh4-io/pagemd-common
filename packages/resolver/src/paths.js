/**
 * Resource folder names and the bundled system files (from pagemd `core/src/paths.js`, phase C4).
 * Change these constants to restructure folders without touching other code.
 */

/** Resource folder per type (relative to a search location) */
export const RESOURCE_PATHS = {
  styles: 'styles',           // project/styles/
  layouts: 'layouts',         // project/layouts/
  templates: 'templates',     // project/templates/
  profiles: 'profiles',       // project/profiles/
};

/**
 * The bundled system stylesheets. They are read straight from `<defaults>/styles/` (no search,
 * lookup 4 in the C4 side-by-side), so these names carry no folder prefix.
 */
export const DEFAULT_FILES = {
  baseCSS: 'base.css',        // styles/base.css
  primaryCSS: 'primary.css',  // styles/primary.css
  syntaxCSS: 'shiki-base.css', // styles/syntax/shiki-base.css
};

/**
 * Get the full path for a resource type and filename
 * @param {string} type - Resource type (styles, layouts, templates, profiles)
 * @param {string} filename - Filename within that resource directory
 * @returns {string} Combined path
 */
export function getResourcePath(type, filename) {
  const basePath = RESOURCE_PATHS[type];
  if (!basePath) {
    throw new Error(`Unknown resource type: ${type}`);
  }
  return `${basePath}/${filename}`;
}
