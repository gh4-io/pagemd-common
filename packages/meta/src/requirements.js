/**
 * Requirements: which properties a document must have, and which ones its
 * template shows on the page.
 * - required: the profile's validation.required_fields, as written
 * - shownOnPage: every metadata.<key> a template token reads, in first-seen
 *   order ({{metadata.x}}, {{metadata.x ?? "default"}}, {{metadata.x ? a : b}})
 */

const TOKEN = /\{\{([^}]+)\}\}/g;
const METADATA_KEY = /\bmetadata\.([A-Za-z_][\w-]*)/g;

/**
 * @param {object} [profile] - A loaded (merged) profile
 * @param {string} [template] - The HTML template's text
 * @returns {{ required: string[], shownOnPage: string[] }}
 */
export function requirements(profile, template) {
  const required = [...(profile?.validation?.required_fields || [])];
  const shown = new Set();
  for (const [, token] of String(template || '').matchAll(TOKEN)) {
    for (const [, key] of token.matchAll(METADATA_KEY)) shown.add(key);
  }
  return { required, shownOnPage: [...shown] };
}
