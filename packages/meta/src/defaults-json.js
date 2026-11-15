/**
 * Builds pagemd's schemas/metadata.defaults.json from the catalogue (R-43).
 * pagemd writes the file with scripts/generate-metadata-defaults.mjs and a
 * test fails when the file and this function disagree, so nobody edits the
 * JSON by hand.
 */

import { CATALOGUE, DEFAULT_VALUES, FIELD_ALIASES } from './catalogue.js';

const NOTE = 'GENERATED from @pagemd/meta catalogue.json by scripts/generate-metadata-defaults.mjs. Do not edit by hand. pagemd does not load this file at render time.';

/** @returns {object} the JSON document */
export function toDefaultsJson() {
  const fieldDefinitions = {};
  for (const f of CATALOGUE.fields) {
    const def = { type: f.normalize?.type ?? f.type, description: f.help };
    if (f.accepts) def.accepts = f.accepts;
    if (f.values) def.values = f.values;
    if (f.normalize?.coerce) def.coercion = { enabled: true, from: ['string'], description: "Convert numeric strings to numbers (e.g., '1' -> 1, '2.5' -> 2.5)" };
    if (f.formats && f.type === 'date') def.formats = { input: f.formats, output: 'MM/DD/YYYY' };
    else if (f.formats) def.format = f.formats[0];
    if (f.validation?.items) def.items = f.validation.items;
    if (f.validation) {
      const { items, ...rest } = f.validation;
      if (Object.keys(rest).length) def.validation = rest;
    }
    if (f.generated) def.generated = true;
    if ('filenameToken' in f) def.filenameToken = f.filenameToken;
    fieldDefinitions[f.key] = def;
  }

  const byRule = (test) => CATALOGUE.fields.filter((f) => f.normalize && test(f.normalize)).map((f) => f.key);

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'PageMD Metadata Defaults',
    description: 'Default metadata values, type definitions, aliases, and validation rules for PageMD documents',
    $comment: NOTE,
    version: CATALOGUE.version,
    defaults: DEFAULT_VALUES,
    fieldDefinitions,
    aliases: FIELD_ALIASES,
    normalization: {
      keyNormalization: { enabled: true, target: 'snake_case', description: 'Convert all keys to snake_case before applying aliases' },
      numberCoercion: { enabled: true, fields: byRule((n) => n.type === 'number' && n.coerce), description: 'Coerce numeric strings to numbers' },
      booleanNormalization: { enabled: true, fields: byRule((n) => n.type === 'boolean'), description: 'true/yes/1 and false/no/0 (any case) become booleans' },
      dateFormatting: { enabled: true, fields: byRule((n) => n.type === 'date'), defaultOutputFormat: 'MM/DD/YYYY', description: 'Parse and format date fields; a date without a time keeps its calendar day in every time zone' },
      stringTrimming: { enabled: true, fields: byRule((n) => n.type === 'string' && n.trim), description: 'Trim leading/trailing whitespace from string fields' },
      arrayNormalization: { enabled: true, fields: byRule((n) => n.type === 'array'), description: 'Ensure array fields are arrays; convert single values to single-element arrays' }
    },
    filenameTokens: {
      allowlist: CATALOGUE.fields.filter((f) => f.filenameToken).map((f) => f.key),
      description: 'Only these metadata fields can be used in filename patterns'
    },
    validation: {
      strictMode: false,
      profileOverride: true,
      description: 'Unknown fields are allowed and kept as written. Profiles set required fields (validation.required_fields); the base catalogue requires none'
    }
  };
}

/** @returns {string} the file's exact text */
export function toDefaultsJsonText() {
  return JSON.stringify(toDefaultsJson(), null, 2) + '\n';
}
