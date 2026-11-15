/**
 * Layering: how a document's final properties are put together.
 *
 * Order, lowest priority first (user decision OQ-13, 2026-09-26):
 *   built-in defaults → profile defaults → the document's frontmatter → caller overrides
 * A profile default therefore fills a property the document leaves out, even
 * one that also has a built-in default (e.g. sop's `approver: "TBD"`).
 *
 * Before C7 pagemd filled the built-ins in at parse time, so they beat the
 * profile. The document metadata passed here must be normalized WITHOUT
 * built-in defaults (normalizeMetadata(raw, { applyDefaults: false })).
 *
 * Key order follows the old merge (profile keys, then the document's, then
 * built-ins nobody set, then overrides), so only the values that the fix is
 * about change.
 */

import { DEFAULT_VALUES } from './catalogue.js';
import { applyDefaults } from './normalize.js';

/** Lowest priority first */
export const LAYER_ORDER = Object.freeze(['builtInDefaults', 'profileDefaults', 'documentMetadata', 'overrides']);

/**
 * @param {object} [profileDefaults] - profile.metadata.defaults
 * @param {object} [documentMetadata] - normalizeMetadata(frontmatter, { applyDefaults: false })
 * @param {object} [overrides] - caller's extra properties (renderMarkdown's options.metadata)
 * @param {object} [builtInDefaults] - defaults to the catalogue's DEFAULT_VALUES
 * @returns {object} the merged properties
 */
export function layer(profileDefaults, documentMetadata, overrides, builtInDefaults = DEFAULT_VALUES) {
  // Built-ins fill only what the profile and the document left out; overrides
  // go last, where the old merge put them (keeps the key order unchanged)
  return {
    ...applyDefaults({ ...(profileDefaults || {}), ...documentMetadata }, builtInDefaults),
    ...overrides
  };
}
