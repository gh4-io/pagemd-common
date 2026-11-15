/**
 * Annotated-image write rule (phase C3, A2, A3).
 *
 *   ::: annotated-image <path>
 *   <YAML>
 *   :::
 *
 * The author's YAML is kept (A2): when the block had YAML, only the entries
 * that changed are rewritten (see ../shared/yaml-edit.js); comments, `{ }`
 * maps, key order and untouched lines stay as written. The result is read back
 * with the renderer's own reader; if it does not say what was asked (or the
 * old YAML could not be read), the YAML is written fresh in the canonical form
 * below.
 *
 * Canonical form (new blocks):
 *   ::: annotated-image shots/app.png
 *   options:
 *     caption: "The main window"
 *   markers:
 *     - { id: 1, x: 10, y: 20, label: "Menu" }
 *   :::
 * Keys: options first, then the shape lists in the order markers, arrows,
 * boxes, text, lines, ellipses, highlights, then the redaction rectangles
 * (`redact`, C13); each entry keeps its own key order.
 * Strings are double-quoted (a line break becomes \n), numbers are exact.
 * The image path stays on the opening line (one line), and no YAML line can be
 * only ":::" (every generated string sits on one quoted line).
 */

import { loadAnnotationYaml, normalizeAnnotationData } from './annotated-image.js';
import { updateYaml, sameData, formatYamlValue } from '../shared/yaml-edit.js';
import { oneLine } from '../shared/write.js';

/** The keys of the normalised data, in canonical order */
export const ANNOTATION_KEYS = Object.freeze(['options', 'markers', 'arrows', 'boxes', 'text', 'lines', 'ellipses', 'highlights', 'redact']);

const CLOSE_LINE = /^[ \t]*:::[ ]*$/m;

/**
 * Is this value empty for its key (no options / no entries)?
 * @param {string} key
 * @param {*} value
 * @returns {boolean}
 */
function isEmpty(key, value) {
  if (value === undefined || value === null) return true;
  if (key === 'options') return typeof value !== 'object' || Object.keys(value).length === 0;
  return Array.isArray(value) && value.length === 0;
}

/**
 * The canonical YAML for normalised data
 * @param {object} data - options plus shape lists
 * @returns {string}
 */
export function canonicalAnnotationYaml(data) {
  const out = [];
  const keys = [...ANNOTATION_KEYS, ...Object.keys(data || {}).filter((k) => !ANNOTATION_KEYS.includes(k))];
  for (const key of keys) {
    const value = data ? data[key] : undefined;
    if (isEmpty(key, value)) continue;
    if (key === 'options' || (value && typeof value === 'object' && !Array.isArray(value))) {
      out.push(`${key}:`);
      for (const [k, v] of Object.entries(value)) out.push(`  ${k}: ${formatYamlValue(v)}`);
    } else if (Array.isArray(value)) {
      out.push(`${key}:`);
      for (const entry of value) out.push(`  - ${formatYamlValue(entry)}`);
    } else {
      out.push(`${key}: ${formatYamlValue(value)}`);
    }
  }
  return out.join('\n');
}

/**
 * What the author's YAML should hold after the change: their own structure,
 * with only the parts whose normalised value changed replaced.
 * @param {*} raw - The old YAML's value
 * @param {object} next - The new normalised data
 * @returns {*}
 */
function targetFor(raw, next) {
  if (Array.isArray(raw)) {
    const onlyMarkers = ANNOTATION_KEYS.every((k) => k === 'markers' || isEmpty(k, next[k]));
    if (onlyMarkers) return next.markers || [];
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const target = { ...raw };
  const old = normalizeAnnotationData(raw);
  for (const key of ANNOTATION_KEYS) {
    const empty = key === 'options' ? {} : [];
    const value = next[key] === undefined ? empty : next[key];
    if (sameData(value, old[key] === undefined ? empty : old[key])) continue;
    if (isEmpty(key, value)) delete target[key];
    else target[key] = value;
  }
  return target;
}

/**
 * Write an annotated image back to markdown
 * @param {object} data - What the annotated_image token carries
 * @param {string} data.imagePath - The image path (meta.imagePath)
 * @param {object} data.data - The annotations, normalised (meta.data): options plus shape lists
 * @param {string} [data.content] - The YAML as written (token.content); omit for a new block
 * @returns {string}
 */
export function writeAnnotatedImage(data) {
  const path = oneLine(data.imagePath);
  const next = data.data || {};
  let yamlText = null;

  if (typeof data.content === 'string') {
    let raw;
    let readable = true;
    try {
      raw = loadAnnotationYaml(data.content);
    } catch {
      readable = false;
    }
    if (readable && sameData(normalizeAnnotationData(raw), normalizeAnnotationData(next))) {
      yamlText = data.content;
    } else if (readable) {
      const target = targetFor(raw, next);
      const updated = target === null ? null : updateYaml(data.content, raw, target);
      if (updated !== null && readsAs(updated, next)) yamlText = updated;
    }
  }
  if (yamlText === null) yamlText = canonicalAnnotationYaml(next);
  if (CLOSE_LINE.test(yamlText)) yamlText = canonicalAnnotationYaml(next);

  return `::: annotated-image ${path}\n${yamlText ? `${yamlText}\n` : ''}:::`;
}

/**
 * Does this YAML text read back (with the renderer's reader) as the wanted data?
 * @param {string} text
 * @param {object} next - Normalised data
 * @returns {boolean}
 */
function readsAs(text, next) {
  try {
    return sameData(normalizeAnnotationData(loadAnnotationYaml(text)), normalizeAnnotationData(next));
  } catch {
    return false;
  }
}
