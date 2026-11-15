/**
 * The profile's `validation` setting (ADR-0017 V4, phase C8).
 *
 *   validation: true                      every level on, with its defaults
 *   validation: { strict, required_fields, meta, profile, template, layout, styles, syntax, assets }
 *     each level: true | false | an options object (an object means on)
 *     a level that isn't listed is on once a block exists (ADR-0017; R-188)
 *     required_fields (legacy, every profile before C8) = meta.required_fields
 *   no block, false, or anything else    no checks at all (R-30)
 */

/** The levels, in the order their checks run and their results are listed. */
export const LEVELS = Object.freeze(['meta', 'profile', 'template', 'layout', 'styles', 'syntax', 'assets']);

/** Every key a `validation` object may hold. */
export const VALIDATION_KEYS = Object.freeze(['strict', 'required_fields', ...LEVELS]);

/**
 * @typedef {object} ValidationConfig
 * @property {boolean} enabled - false: the profile asks for no checks
 * @property {boolean} strict - warnings fail too (`validation.strict`; the CLI's --strict adds to it)
 * @property {Record<string, { on: boolean, options: object }>} levels
 * @property {string[]} requiredFields - meta.required_fields, else the legacy required_fields
 * @property {string[]} unknownKeys - keys of the block that aren't settings (the profile level reports them)
 */

/**
 * @param {*} validation - the merged profile's `validation`
 * @returns {ValidationConfig}
 */
export function readConfig(validation) {
  const off = { enabled: false, strict: false, levels: Object.fromEntries(LEVELS.map((l) => [l, { on: false, options: {} }])), requiredFields: [], unknownKeys: [] };
  if (validation === true) {
    return { ...off, enabled: true, levels: Object.fromEntries(LEVELS.map((l) => [l, { on: true, options: {} }])) };
  }
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) return off;

  const levels = {};
  for (const level of LEVELS) {
    const value = validation[level];
    if (value === false) levels[level] = { on: false, options: {} };
    else if (value && typeof value === 'object' && !Array.isArray(value)) levels[level] = { on: true, options: value };
    else levels[level] = { on: true, options: {} };
  }
  const metaFields = levels.meta.options.required_fields;
  const requiredFields = Array.isArray(metaFields)
    ? metaFields
    : Array.isArray(validation.required_fields) ? validation.required_fields : [];
  return {
    enabled: true,
    strict: validation.strict === true,
    levels,
    requiredFields: requiredFields.filter((f) => typeof f === 'string'),
    unknownKeys: Object.keys(validation).filter((k) => !VALIDATION_KEYS.includes(k))
  };
}
