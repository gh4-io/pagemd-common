/**
 * The field catalogue: every document property pagemd knows about.
 *
 * catalogue.json is the single source. The three tables pagemd's parser used
 * to hard-code (FIELD_ALIASES, DEFAULT_VALUES, FIELD_DEFINITIONS in
 * parser/src/metadata.js) are derived from it here, with the same entries in
 * the same order, so normalizing gives byte-identical results.
 */

import data from '../catalogue.json' with { type: 'json' };

/**
 * @typedef {object} FieldSpec
 * @property {string} key - Canonical snake_case key
 * @property {'string'|'number'|'boolean'|'date'|'enum'|'list'|'path'} type - What the value is, for UI and checks
 * @property {string} label - Short name for UI
 * @property {string} help - One-line explanation
 * @property {*} [default] - Present only when the parser fills this property in when it is missing
 * @property {{type: string, trim?: boolean, coerce?: boolean, items?: string}} [normalize] - The parser's value rule
 * @property {string[]} aliases - Other keys that mean this property (as listed; keys are snake_cased first)
 * @property {object} [validation] - Descriptive limits (not enforced by the parser)
 * @property {string[]} [formats] - Accepted input formats (dates)
 * @property {string[]} [values] - Known values (enums, presets)
 * @property {string[]} [accepts] - Value shapes the renderer accepts, when more than one
 * @property {string[]} [items] - Syntax item ids this property configures
 * @property {boolean} [filenameToken] - Usable in output filename patterns
 * @property {boolean} [generated] - Filled in at render time, not by authors
 * @property {string[]} sources - Where the property was found: parser, json, renderer, template, profile
 */

/** @typedef {{ version: string, fields: FieldSpec[], aliases: Record<string,string>, gates: Record<string,{field:string,value:*}> }} MetaCatalogue */

/** @type {MetaCatalogue} */
export const CATALOGUE = data;

/** Alias → canonical key (was parser/src/metadata.js FIELD_ALIASES) */
export const FIELD_ALIASES = { ...data.aliases };

/** Built-in defaults, filled in when a key is missing (was DEFAULT_VALUES) */
export const DEFAULT_VALUES = Object.fromEntries(
  data.fields.filter((f) => 'default' in f).map((f) => [f.key, f.default])
);

/** Value rules per key (was FIELD_DEFINITIONS) */
export const FIELD_DEFINITIONS = Object.fromEntries(
  data.fields.filter((f) => f.normalize).map((f) => [f.key, { ...f.normalize, ...(f.formats ? { formats: f.formats } : {}) }])
);

const aliasesByKey = {};
for (const [alias, key] of Object.entries(data.aliases)) {
  (aliasesByKey[key] ??= []).push(alias);
}

const withAliases = (f) => ({ ...f, aliases: aliasesByKey[f.key] || [] });

const inferType = (value) =>
  Array.isArray(value) ? 'list' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';

/**
 * The catalogue as FieldSpec[], extended by a profile.
 * A profile adds its own fields (e.g. doc_type, review_status): every key in
 * profile.metadata.defaults or profile.validation.required_fields that the
 * base catalogue doesn't know becomes a field with source 'profile'.
 * @param {object} [profile] - A loaded (merged) profile
 * @returns {FieldSpec[]}
 */
export function catalogue(profile) {
  const fields = data.fields.map(withAliases);
  if (!profile) return fields;

  const known = new Set([...fields.map((f) => f.key), ...Object.keys(data.aliases)]);
  const profileDefaults = profile.metadata?.defaults || {};
  const extraKeys = [
    ...Object.keys(profileDefaults),
    ...(profile.validation?.required_fields || [])
  ];
  for (const key of extraKeys) {
    if (known.has(key)) continue;
    known.add(key);
    const hasDefault = key in profileDefaults;
    fields.push({
      key,
      type: hasDefault && profileDefaults[key] !== null ? inferType(profileDefaults[key]) : 'string',
      label: key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      help: `Defined by profile ${profile.id || profile.name || ''}`.trim(),
      aliases: [],
      sources: ['profile']
    });
  }
  return fields;
}

/**
 * One field by canonical key or alias.
 * @param {string} key
 * @param {object} [profile]
 * @returns {FieldSpec|undefined}
 */
export function fieldFor(key, profile) {
  const canonical = data.aliases[key] || key;
  return catalogue(profile).find((f) => f.key === canonical);
}
