/**
 * Level `meta`: the document's properties (ADR-0017).
 * - required fields (`meta.required_fields`, else the legacy `required_fields`): missing → error, empty → warning.
 *   A field counts as present when written under its own name, under the same name with other case or `_`/`-`
 *   (pagemd validate's check before C8), or under a nickname @pagemd/meta knows (`doc_id` for `document_id`, R-187).
 *   Messages are pagemd validate's own, word for word.
 * - a value of the wrong type for a property pagemd reads (a number, a yes/no, a date, a choice) → warning
 * - a gated item used while its property is off (a lettered list without `fancy_lists: true`) → warning
 * - a property the template shows on the page, written but left empty (not a required one) → info
 * - properties no part of pagemd knows (not in the catalogue, the profile or the template) → one info listing them
 */

import { catalogue, FIELD_DEFINITIONS, fieldFor, gateFor, normalize, requirements } from '@pagemd/meta';
import { itemOccurrences } from '@pagemd/syntax';
import { diagnostic } from '../diagnostic.js';

const squash = (key) => key.toLowerCase().replace(/[_-]/g, '');

/** The canonical key @pagemd/meta gives a field name (`doc_id` → `document_id`). */
function canonical(field) {
  return Object.keys(normalize({ [field]: true }, { applyDefaults: false }).values)[0] ?? field;
}

const BOOLEAN_WORDS = new Set(['true', 'false', 'yes', 'no', '1', '0']);

/** Why a written value isn't the type pagemd reads, or null. */
function typeProblem(key, value) {
  if (value === null || value === undefined) return null;
  const field = fieldFor(key);
  if (field?.type === 'enum' && Array.isArray(field.values) && !field.values.includes(value)) {
    return `should be one of ${field.values.join(', ')}`;
  }
  const def = FIELD_DEFINITIONS[key];
  if (!def) return null;
  if (def.type === 'number' && typeof value !== 'number') {
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value.trim()))) return null;
    return 'should be a number';
  }
  if (def.type === 'boolean' && typeof value !== 'boolean') {
    if (typeof value === 'number' || (typeof value === 'string' && BOOLEAN_WORDS.has(value.toLowerCase().trim()))) return null;
    return 'should be true or false';
  }
  if (def.type === 'date' && typeof value === 'string' && value.trim() !== '' && Number.isNaN(new Date(value.trim()).getTime()) &&
      !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value.trim()) && !/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(value.trim())) {
    return "isn't a date pagemd can read (it is printed as written)";
  }
  return null;
}

/** The item a gate switches on, as authors know it. */
const GATED_LABEL = { 'fancy-lists': 'this lettered or roman list prints as a numbered list' };

/** @returns {Generator<object, import('../diagnostic.js').Diagnostic[]>} */
export default function* meta(ctx) {
  const out = [];
  const { written, frontmatter, writtenKeys, resolved, config } = ctx;
  const rawKeys = Object.keys(written);
  const squashed = rawKeys.map(squash);

  // Required fields
  for (const field of config.requiredFields) {
    const key = canonical(field);
    const present = field in written || squashed.includes(squash(field)) || Object.hasOwn(frontmatter, key);
    if (!present) {
      out.push(diagnostic('error', 'meta', 'missing-required-field', `Missing required field: ${field} (required by profile ${resolved.profileId})`, { line: 0 }));
      continue;
    }
    const value = Object.hasOwn(frontmatter, key) ? frontmatter[key] : written[rawKeys[squashed.indexOf(squash(field))]] ?? written[field];
    if (value === '' || value === null || value === undefined) {
      out.push(diagnostic('warning', 'meta', 'empty-required-field', `Required field '${field}' is present but empty`, { line: lineOf(ctx, writtenKeys[key] ?? field) }));
    }
  }

  // Types
  for (const [key, authorKey] of Object.entries(writtenKeys)) {
    const problem = typeProblem(key, written[authorKey]);
    if (problem) {
      out.push(diagnostic('warning', 'meta', 'wrong-type', `Property ${authorKey}: ${JSON.stringify(written[authorKey])} ${problem}`, { line: lineOf(ctx, authorKey) }));
    }
  }

  // Gated items used while their property is off
  const settings = resolved.metadata;
  for (const occurrence of itemOccurrences(ctx.tokens())) {
    const gate = gateFor(occurrence.item);
    if (!gate || settings[gate.field] === gate.value) continue;
    const what = GATED_LABEL[occurrence.item] ?? `${occurrence.item} is switched off`;
    out.push(diagnostic('warning', 'meta', 'gate-off', `${gate.field} is not ${JSON.stringify(gate.value)}, so ${what}: add ${gate.field}: ${JSON.stringify(gate.value)} to the frontmatter`, { line: occurrence.token.map?.[0] }));
  }

  // Shown on the page but left empty
  const templateText = resolved.template?.path ? yield* ctx.read(resolved.template.path) : null;
  const shownOnPage = requirements(resolved.profile, templateText ?? '').shownOnPage.map(canonical);
  const required = new Set(config.requiredFields.map(canonical));
  for (const key of shownOnPage) {
    if (required.has(key) || !Object.hasOwn(writtenKeys, key)) continue;
    const value = written[writtenKeys[key]];
    if (value === '' || value === null || (Array.isArray(value) && value.length === 0)) {
      out.push(diagnostic('info', 'meta', 'empty-shown-field', `Property ${writtenKeys[key]} is shown on the page but empty`, { line: lineOf(ctx, writtenKeys[key]) }));
    }
  }

  // Unknown properties
  const known = new Set(catalogue(resolved.profile).map((f) => f.key));
  for (const field of config.requiredFields) known.add(canonical(field));
  for (const key of Object.keys(resolved.profile.metadata?.defaults ?? {})) known.add(canonical(key));
  for (const key of shownOnPage) known.add(key);
  const unknown = Object.entries(writtenKeys).filter(([key]) => !known.has(key)).map(([, authorKey]) => authorKey);
  if (unknown.length > 0) {
    const what = unknown.length === 1 ? `Property ${unknown[0]} is` : `${unknown.length} properties are`;
    out.push(diagnostic('info', 'meta', 'unknown-property', `${what} not used by pagemd, the profile or the template${unknown.length === 1 ? '' : `: ${unknown.join(', ')}`}`, { line: lineOf(ctx, unknown[0]) }));
  }
  return out;
}

/** The line of `key:` in the frontmatter (0-based), else 0. */
export function lineOf(ctx, key) {
  const lines = ctx.input.text.split('\n');
  const re = new RegExp(`^\\s*["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`);
  for (let i = 1; i < lines.length; i++) {
    if (/^---/.test(lines[i])) break;
    if (re.test(lines[i])) return i;
  }
  return 0;
}
