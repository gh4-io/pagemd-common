/**
 * Fancy-list marker write rule (phase C3): a. b. c. / A. B. / i. ii. / I. II. /
 * 1. 2. 3., with "." or ")" as the author wrote it.
 *
 * The editor writes the list; this gives the marker of item `index` (0-based)
 * and the space after it. An upper-case letter followed by "." needs two
 * spaces (the reader's rule, so "B. Smith" at a line start is not a list).
 *
 * Letters run a-z (one letter; the reader accepts no more). A lower-case list
 * starting at 9 ("i.") or an upper-case one at 9 ("I.") reads back as Roman
 * numerals: the reader prefers Roman there, so such a start cannot be written.
 * The reader looks at the first 10 characters of a line only, so a Roman
 * marker longer than 9 letters (e.g. 388 = ccclxxxviii) is not read as a list,
 * and a one-letter Roman start other than i (v, x, l, c, d, m: 5, 10, 50, 100,
 * 500, 1000) reads as a letter list.
 *
 * Canonical example:
 *   listMarker({ type: 'a', start: 3, delimiter: ')' }, 1) → 'd)'
 *   markerGap('B.') → '  '
 */

const ROMAN = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
];

/**
 * A number as lower-case Roman numerals
 * @param {number} n - 1 or more
 * @returns {string}
 */
function toRoman(n) {
  let out = '';
  let rest = Math.max(1, Math.floor(n));
  for (const [value, letters] of ROMAN) {
    while (rest >= value) { out += letters; rest -= value; }
  }
  return out;
}

/**
 * The marker of one list item
 * @param {object} data - The ordered_list_open token's data
 * @param {string} [data.type] - 'a' | 'A' | 'i' | 'I'; anything else = numbers
 * @param {number|string} [data.start] - Number of the first item (default 1)
 * @param {string} [data.delimiter] - '.' or ')' (the token's markup)
 * @param {number} [index] - Which item (0-based)
 * @returns {string} e.g. 'c.'
 */
export function listMarker(data, index = 0) {
  const n = (Number.parseInt(data.start, 10) || 1) + index;
  const delimiter = data.delimiter === ')' ? ')' : '.';
  let label;
  if (data.type === 'a' || data.type === 'A') {
    label = String.fromCharCode(96 + Math.min(Math.max(n, 1), 26));
    if (data.type === 'A') label = label.toUpperCase();
  } else if (data.type === 'i' || data.type === 'I') {
    label = toRoman(n);
    if (data.type === 'I') label = label.toUpperCase();
  } else {
    label = String(Math.max(n, 0));
  }
  return `${label}${delimiter}`;
}

/**
 * The space after a marker: two after one upper-case letter and ".", else one
 * @param {string} marker - e.g. 'B.'
 * @returns {string}
 */
export function markerGap(marker) {
  return /^[A-Z]\.$/.test(marker) ? '  ' : ' ';
}
