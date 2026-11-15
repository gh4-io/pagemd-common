/**
 * Change a YAML text to hold new values while keeping everything the author
 * wrote around them: comments, `{ }` flow maps, key order, quoting, blank lines
 * (phase C3, A2).
 *
 * How: the `yaml` library (eemeli/yaml) reads the text into a tree whose nodes
 * know their place in the text. The old and new values are compared, and only
 * the text of what changed is replaced (a value, one list entry, one key).
 * Nothing is re-printed, so an untouched line is never reformatted.
 *
 * js-yaml stays the reader that decides what a YAML text means (pagemd reads
 * annotated images with it); `yaml` is used only to find where things are.
 * Callers read the result back with their own reader and fall back to a full
 * rewrite if it doesn't say what they wanted (see annotated-image-write.js).
 */

import { parseDocument, isMap, isSeq, isScalar } from 'yaml';
import { yamlString, formatNumber } from './write.js';

/**
 * Deep equality for YAML data (Dates compared by time)
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function sameData(a, b) {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameData(v, b[i]));
  }
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameData(a[k], b[k]));
  }
  return false;
}

/**
 * A plain object (not an array, Date or null)
 * @param {*} v
 * @returns {boolean}
 */
function isPlain(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

// Words a YAML reader could take as true/false/null (yes/no/on/off: YAML 1.1 readers).
// Not y/n: coordinate keys are called y, and js-yaml (pagemd's reader) reads them as text.
const RESERVED = /^(?:true|false|null|yes|no|on|off|~)$/i;

/**
 * Can this string be written without quotes (and read back as the same string)?
 * @param {string} s
 * @returns {boolean}
 */
function plainSafe(s) {
  return /^[A-Za-z_][A-Za-z0-9 _./-]*$/.test(s) && !/\s$/.test(s) && !RESERVED.test(s);
}

/**
 * Format one value as YAML text, in flow style for maps and lists.
 * Strings keep the style of the value they replace where that is safe.
 * @param {*} v - Value
 * @param {string} [style] - The replaced scalar's style (PLAIN, QUOTE_SINGLE, QUOTE_DOUBLE)
 * @returns {string}
 */
export function formatYamlValue(v, style = 'QUOTE_DOUBLE') {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return formatNumber(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => formatYamlValue(x)).join(', ')}]` : '[]';
  if (isPlain(v)) {
    const entries = Object.entries(v).map(([k, x]) => `${formatKey(k)}: ${formatYamlValue(x)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  const s = String(v);
  if (style === 'PLAIN' && plainSafe(s)) return s;
  if (style === 'QUOTE_SINGLE' && !/[\r\n]/.test(s)) return `'${s.replace(/'/g, "''")}'`;
  return yamlString(s);
}

/**
 * A map key as YAML text
 * @param {string} k
 * @returns {string}
 */
function formatKey(k) {
  return plainSafe(k) && !k.includes(' ') ? k : yamlString(k);
}

/**
 * The key of a pair as a JS value
 * @param {object} pair - yaml Pair
 * @returns {*}
 */
function keyOf(pair) {
  return isScalar(pair.key) ? pair.key.value : pair.key;
}

/** Start of the line holding position pos */
const lineStart = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;

/** Position just after the line break ending the line that holds pos (or the text's end) */
function lineAfter(text, pos) {
  const nl = text.indexOf('\n', pos);
  return nl < 0 ? text.length : nl + 1;
}

/** Position of the line break ending the line that holds pos (or the text's end) */
function lineEnd(text, pos) {
  const nl = text.indexOf('\n', pos);
  return nl < 0 ? text.length : nl;
}

/** Column of pos in its line */
const column = (text, pos) => pos - lineStart(text, pos);

/**
 * End of a node's own text (its value, not trailing comments or line breaks)
 * @param {object} node - yaml node
 * @returns {number}
 */
const valueEnd = (node) => node.range[1];

/**
 * Update a YAML text from old data to new data, touching only what changed.
 * @param {string} text - The YAML as written
 * @param {*} oldData - What the text holds (as the caller's reader sees it)
 * @param {*} newData - What it should hold
 * @returns {string|null} The new text, or null when the change can't be made in place
 */
export function updateYaml(text, oldData, newData) {
  if (sameData(oldData, newData)) return text;
  let doc;
  try {
    doc = parseDocument(text, { keepSourceTokens: false });
  } catch {
    return null;
  }
  if (doc.errors.length || !doc.contents) return null;
  const edits = [];
  if (!diff(text, doc.contents, oldData, newData, edits)) return null;
  edits.sort((a, b) => b.from - a.from || b.to - a.to);
  let out = text;
  for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}

/**
 * Compare old and new data under one node and record text edits
 * @returns {boolean} false when the change can't be made in place
 */
function diff(text, node, oldV, newV, edits) {
  if (sameData(oldV, newV)) return true;
  if (!node || !node.range) return false;

  if (isMap(node) && isPlain(oldV) && isPlain(newV)) {
    for (const pair of node.items) {
      const key = keyOf(pair);
      if (typeof key !== 'string' && typeof key !== 'number') return false;
      if (!(key in oldV)) return false; // duplicate or merge keys: don't guess
      if (key in newV) {
        if (!diff(text, pair.value, oldV[key], newV[key], edits)) return false;
      } else if (!removePair(text, node, pair, edits)) return false;
    }
    const added = Object.keys(newV).filter((k) => !(k in oldV));
    for (const key of added) if (!addPair(text, node, key, newV[key], edits)) return false;
    return true;
  }

  if (isSeq(node) && Array.isArray(oldV) && Array.isArray(newV)) {
    if (node.items.length !== oldV.length) return false;
    const o = oldV.length;
    const n = newV.length;
    // One entry removed or inserted: touch only that entry
    if (n === o - 1) {
      const k = firstDifference(oldV, newV);
      if (sameData(oldV.slice(k + 1), newV.slice(k))) return removeItem(text, node, k, edits);
    }
    if (n === o + 1) {
      const k = firstDifference(oldV, newV);
      if (sameData(oldV.slice(k), newV.slice(k + 1))) return insertItem(text, node, k, newV[k], edits);
    }
    for (let i = 0; i < Math.min(o, n); i++) {
      if (!diff(text, node.items[i], oldV[i], newV[i], edits)) return false;
    }
    for (let i = o - 1; i >= n; i--) if (!removeItem(text, node, i, edits)) return false;
    for (let i = o; i < n; i++) if (!insertItem(text, node, i, newV[i], edits)) return false;
    return true;
  }

  if (isScalar(node) && !isPlain(newV) && !Array.isArray(newV)) {
    edits.push({ from: node.range[0], to: valueEnd(node), text: formatYamlValue(newV, node.type) });
    return true;
  }
  return false;
}

/** Index of the first entry where two lists differ */
function firstDifference(a, b) {
  let k = 0;
  while (k < a.length && k < b.length && sameData(a[k], b[k])) k++;
  return k;
}

/**
 * Add a key to a map
 */
function addPair(text, map, key, value, edits) {
  const entry = `${formatKey(key)}: ${formatYamlValue(value)}`;
  if (map.flow) {
    const close = text.lastIndexOf('}', map.range[1] - 1);
    if (close < map.range[0]) return false;
    if (!map.items.length) {
      edits.push({ from: map.range[0], to: close + 1, text: `{ ${entry} }` });
      return true;
    }
    let at = close;
    while (at > map.range[0] && /\s/.test(text[at - 1])) at--;
    edits.push({ from: at, to: at, text: `, ${entry}` });
    return true;
  }
  if (!map.items.length) return false;
  const first = map.items[0];
  const last = map.items[map.items.length - 1];
  const indent = ' '.repeat(column(text, first.key.range[0]));
  const end = last.value && last.value.range ? valueEnd(last.value) : last.key.range[1];
  const at = lineEnd(text, Math.max(end - 1, 0));
  edits.push({ from: at, to: at, text: `\n${indent}${blockEntry(key, value, indent)}` });
  return true;
}

/**
 * A new block-map entry: lists of maps as "- { … }" lines, everything else inline
 */
function blockEntry(key, value, indent) {
  if (Array.isArray(value) && value.length) {
    return `${formatKey(key)}:${value.map((v) => `\n${indent}  - ${formatYamlValue(v)}`).join('')}`;
  }
  return `${formatKey(key)}: ${formatYamlValue(value)}`;
}

/**
 * Remove a key from a map
 */
function removePair(text, map, pair, edits) {
  const idx = map.items.indexOf(pair);
  const start = pair.key.range[0];
  const end = pair.value && pair.value.range ? valueEnd(pair.value) : pair.key.range[1];
  if (map.flow) return removeFlowEntry(text, map, idx, start, end, edits);
  const from = lineStart(text, start);
  const to = lineAfter(text, Math.max(end - 1, start));
  edits.push({ from, to, text: '' });
  return true;
}

/**
 * Remove one entry (of a flow map or flow list) with its comma
 */
function removeFlowEntry(text, coll, idx, start, end, edits) {
  const items = coll.items;
  if (items.length === 1) {
    edits.push({ from: start, to: end, text: '' });
    return true;
  }
  if (idx > 0) {
    const comma = text.lastIndexOf(',', start);
    if (comma < coll.range[0]) return false;
    edits.push({ from: comma, to: end, text: '' });
    return true;
  }
  const next = items[1];
  const nextStart = isScalar(next) || next.range ? next.range[0] : next.key.range[0];
  edits.push({ from: start, to: nextStart, text: '' });
  return true;
}

/**
 * Remove one list entry
 */
function removeItem(text, seq, i, edits) {
  const item = seq.items[i];
  if (!item || !item.range) return false;
  if (seq.flow) return removeFlowEntry(text, seq, i, item.range[0], valueEnd(item), edits);
  const from = lineStart(text, item.range[0]);
  const to = lineAfter(text, Math.max(valueEnd(item) - 1, item.range[0]));
  edits.push({ from, to, text: '' });
  return true;
}

/**
 * Insert one list entry before entry i (or at the end when i is the length)
 */
function insertItem(text, seq, i, value, edits) {
  const entry = formatYamlValue(value);
  if (!seq.items.length) return false;
  if (seq.flow) {
    if (i < seq.items.length) {
      const at = seq.items[i].range[0];
      edits.push({ from: at, to: at, text: `${entry}, ` });
    } else {
      const last = seq.items[seq.items.length - 1];
      const at = valueEnd(last);
      edits.push({ from: at, to: at, text: `, ${entry}` });
    }
    return true;
  }
  const firstStart = seq.items[0].range[0];
  const dash = text.lastIndexOf('-', firstStart);
  if (dash < lineStart(text, firstStart)) return false;
  const indent = ' '.repeat(column(text, dash));
  if (i < seq.items.length) {
    const at = lineStart(text, seq.items[i].range[0]);
    edits.push({ from: at, to: at, text: `${indent}- ${entry}\n` });
  } else {
    const last = seq.items[seq.items.length - 1];
    const at = lineEnd(text, Math.max(valueEnd(last) - 1, last.range[0]));
    edits.push({ from: at, to: at, text: `\n${indent}- ${entry}` });
  }
  return true;
}
