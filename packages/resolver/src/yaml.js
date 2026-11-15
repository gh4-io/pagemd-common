/**
 * One YAML reader for profiles and config files, with js-yaml 4's rules (from pagemd
 * `core/src/yaml.js`, phase U1; moved here in C4 and re-exported by pagemd's core).
 *
 * js-yaml 5 reads plain YAML 1.2 by default: `date: 2024-01-15` stays a string and `<<` merge keys
 * are not applied, and empty input throws. js-yaml 4 did both and returned undefined for an empty
 * or comment-only file. LEGACY_SCHEMA and loadYaml() keep that behaviour.
 */

import { load, loadAll, CORE_SCHEMA, timestampTag, mergeTag, binaryTag, omapTag, pairsTag } from 'js-yaml';

/** YAML 1.2 core rules plus the js-yaml 4 extras: dates, `<<` merges, !!binary, !!omap, !!pairs. */
export const LEGACY_SCHEMA = CORE_SCHEMA.withTags(timestampTag, mergeTag, binaryTag, omapTag, pairsTag);

/**
 * Parse one YAML document.
 * @param {string} text
 * @returns {*} the value, or undefined when the text holds no document (empty or comments only)
 */
export function loadYaml(text) {
  const docs = loadAll(text, { schema: LEGACY_SCHEMA });
  if (docs.length <= 1) return docs[0];
  return load(text, { schema: LEGACY_SCHEMA }); // several documents: throws, as js-yaml 4 did
}
