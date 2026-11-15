/**
 * Metadata normalization: key normalization, aliases, type coercion, defaults.
 *
 * Moved from pagemd parser/src/metadata.js (phase C7). The code is today's,
 * with one approved change (R-35): a date written without a time stays the
 * same calendar day in every time zone. Before, it was read as UTC midnight
 * and printed in local time, so west of UTC it moved back a day.
 */

import { FIELD_ALIASES, DEFAULT_VALUES, FIELD_DEFINITIONS } from './catalogue.js';

/**
 * Convert key to snake_case
 * @param {string} key - Key to normalize
 * @returns {string} snake_case key
 */
export function normalizeKey(key) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1_$2')  // camelCase -> snake_case
    .replace(/[-\s]+/g, '_')               // dashes/spaces -> underscores
    .toLowerCase();
}

// Date-only ISO forms (YYYY, YYYY-MM, YYYY-MM-DD): JavaScript reads these as
// UTC midnight, unlike every other form, which it reads as local time
const ISO_DATE_ONLY = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/**
 * The same calendar day as `utcDate`'s UTC date, at local midnight, so
 * formatDate's local getters print the day that was written (R-35)
 * @param {Date} utcDate
 * @returns {Date}
 */
function calendarDay(utcDate) {
  const local = new Date(0);
  local.setFullYear(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate());
  local.setHours(0, 0, 0, 0);
  return local;
}

/**
 * A Date that carries no time of day (YAML reads `date: 2024-01-15` as UTC
 * midnight) is a calendar date; one with a time is a moment, printed in local time
 * @param {Date} date
 * @returns {boolean}
 */
const isUtcMidnight = (date) =>
  date.getUTCHours() === 0 && date.getUTCMinutes() === 0 &&
  date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;

/**
 * Parse date string to Date object
 * Supports multiple input formats
 * @param {string} dateStr - Date string to parse
 * @returns {Date|null} Parsed date or null if invalid
 */
function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const trimmed = dateStr.trim();

  // Try ISO 8601 first
  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime())) {
    return ISO_DATE_ONLY.test(trimmed) ? calendarDay(isoDate) : isoDate;
  }

  // MM/DD/YYYY or MM/DD/YY
  const usFormat = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const usMatch = trimmed.match(usFormat);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const date = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!isNaN(date.getTime())) return calendarDay(date);
  }

  // MM-DD-YYYY
  const dashFormat = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
  const dashMatch = trimmed.match(dashFormat);
  if (dashMatch) {
    const [, month, day, year] = dashMatch;
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!isNaN(date.getTime())) return calendarDay(date);
  }

  // DD MMM YYYY (e.g., "15 Jan 2024")
  const textFormat = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/;
  const textMatch = trimmed.match(textFormat);
  if (textMatch) {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) return date;
  }

  return null;
}

/**
 * Format date to MM/DD/YYYY
 * @param {Date} date - Date object to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}

/**
 * Normalize value based on field type definition
 * @param {string} key - Field key (normalized)
 * @param {*} value - Raw value to normalize
 * @param {object} fieldDefs - Field definitions (default: FIELD_DEFINITIONS)
 * @returns {*} Normalized value
 */
export function normalizeValue(key, value, fieldDefs = FIELD_DEFINITIONS) {
  const fieldDef = fieldDefs[key];
  if (!fieldDef) return value;

  // Handle null/undefined
  if (value === null || value === undefined) return value;

  const { type, trim, coerce, items } = fieldDef;

  // String normalization
  if (type === 'string') {
    const strValue = String(value);
    return trim ? strValue.trim() : strValue;
  }

  // Number coercion
  if (type === 'number' && coerce) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const num = trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10);
      return isNaN(num) ? value : num;
    }
  }

  // Boolean normalization
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim();
      if (lower === 'true' || lower === 'yes' || lower === '1') return true;
      if (lower === 'false' || lower === 'no' || lower === '0') return false;
    }
    if (typeof value === 'number') return value !== 0;
    return Boolean(value);
  }

  // Date normalization
  if (type === 'date') {
    if (value instanceof Date) {
      return formatDate(!isNaN(value.getTime()) && isUtcMidnight(value) ? calendarDay(value) : value);
    }
    if (typeof value === 'string') {
      const parsed = parseDate(value);
      return parsed ? formatDate(parsed) : value;
    }
  }

  // Array normalization
  if (type === 'array') {
    if (Array.isArray(value)) {
      // Trim string items if specified
      if (items === 'string') {
        return value.map(v => typeof v === 'string' ? v.trim() : v);
      }
      return value;
    }
    // Convert single value to array
    return [value];
  }

  return value;
}

/**
 * Apply default values for missing fields
 * @param {object} metadata - Metadata object to enhance
 * @param {object} defaults - Default values (default: DEFAULT_VALUES)
 * @returns {object} Metadata with defaults applied
 */
export function applyDefaults(metadata, defaults = DEFAULT_VALUES) {
  const result = { ...metadata };

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!(key in result)) {
      result[key] = defaultValue;
    }
  }

  return result;
}

/**
 * Normalize metadata object
 * - Converts keys to snake_case
 * - Resolves aliases
 * - Coerces types (numbers, dates)
 * - Trims strings
 * - Normalizes arrays
 * - Applies defaults
 *
 * @param {object} raw - Raw metadata from frontmatter
 * @param {object} options - Normalization options
 * @param {object} options.aliases - Custom aliases (default: FIELD_ALIASES)
 * @param {object} options.defaults - Custom defaults (default: DEFAULT_VALUES)
 * @param {object} options.fieldDefs - Custom field definitions (default: FIELD_DEFINITIONS)
 * @param {boolean} options.applyDefaults - Whether to apply defaults (default: true)
 * @returns {object} Normalized metadata
 */
export function normalizeMetadata(raw, options = {}) {
  return normalize(raw, options).values;
}

/**
 * normalizeMetadata(), plus the key the author actually wrote for each
 * property (M4): an editor that changes `rev` must write `rev` back, not
 * `revision`, so only the value changes in the file.
 *
 * @param {object} raw - Raw metadata from frontmatter
 * @param {object} options - Same as normalizeMetadata()
 * @returns {{ values: object, keys: Record<string,string> }} values = normalizeMetadata(raw);
 *   keys = canonical key → the author's key (the last one written, as values keeps the last value)
 */
export function normalize(raw, options = {}) {
  const {
    aliases = FIELD_ALIASES,
    defaults = DEFAULT_VALUES,
    fieldDefs = FIELD_DEFINITIONS,
    applyDefaults: shouldApplyDefaults = true
  } = options;

  const normalized = {};
  const keys = {};

  // Process each field
  for (let [key, value] of Object.entries(raw)) {
    // Normalize key to snake_case
    let normalizedKey = normalizeKey(key);

    // Apply alias if exists
    if (aliases[normalizedKey]) {
      normalizedKey = aliases[normalizedKey];
    }

    // Normalize value based on field type
    const normalizedValue = normalizeValue(normalizedKey, value, fieldDefs);

    normalized[normalizedKey] = normalizedValue;
    keys[normalizedKey] = key;
  }

  // Apply defaults for missing fields
  return {
    values: shouldApplyDefaults ? applyDefaults(normalized, defaults) : normalized,
    keys
  };
}
