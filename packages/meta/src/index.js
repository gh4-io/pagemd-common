/**
 * @pagemd/meta - document properties (frontmatter fields).
 *
 * One answer, for the pagemd CLI and pagemd-editor alike, to: which properties
 * exist, what they mean, their defaults, how values are normalized, how
 * profile defaults and the frontmatter are layered, which are required or
 * shown on the page, and which switch syntax items on.
 *
 * Browser-safe: no Node built-ins, no process.*; the catalogue is bundled
 * (see test/browser-safe.test.js).
 */

export {
  CATALOGUE,
  FIELD_ALIASES,
  DEFAULT_VALUES,
  FIELD_DEFINITIONS,
  catalogue,
  fieldFor
} from './catalogue.js';
export { normalizeKey, normalizeValue, applyDefaults, normalizeMetadata, normalize } from './normalize.js';
export { layer, LAYER_ORDER } from './layer.js';
export { requirements } from './requirements.js';
export { gateFor, fieldsForItem } from './gates.js';
export { toDefaultsJson, toDefaultsJsonText } from './defaults-json.js';
