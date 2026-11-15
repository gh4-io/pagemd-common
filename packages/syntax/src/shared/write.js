/**
 * Shared helpers for the write rules (phase C3).
 *
 * Escaping (A3) follows the rules the pagemd-image-tool found against the real
 * parser (its `Output/Escaping.cs`), with one difference: numbers are written
 * exactly as given (C9 keeps decimals; rounding is the caller's job).
 *
 * Every escape here is lossy only for values the syntax cannot hold at all
 * (for example a FIGURE caption with both kinds of quote): those characters
 * are replaced by the nearest character that reads back safely.
 */

/**
 * One line, trimmed: line breaks (and the spaces around them) become one space
 * @param {*} s - Value
 * @returns {string}
 */
export function oneLine(s) {
  return String(s ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/**
 * A number exactly as given (no rounding); non-finite numbers become 0
 * @param {number} n - Number
 * @returns {string}
 */
export function formatNumber(n) {
  return Number.isFinite(n) ? String(n) : '0';
}

/**
 * FIGURE attribute value. The FIGURE reader accepts "…", '…' or a bare word and
 * cannot unescape quotes: use "…", else '…', else turn " into ”. `-->` would end
 * the comment, so it becomes `->`.
 * @param {*} s - Value
 * @returns {string} Quoted value
 */
export function figureValue(s) {
  const v = oneLine(s).replace(/-->/g, '->');
  if (!v.includes('"')) return `"${v}"`;
  if (!v.includes("'")) return `'${v}'`;
  return `"${v.replace(/"/g, '”')}"`;
}

/**
 * Directive attribute value (PAGEBREAK, TOC, SECTION, …). The shared directive
 * reader stops a quoted value at either kind of quote, so " becomes ” and ' becomes ’.
 * @param {*} s - Value
 * @returns {string} Quoted value
 */
export function directiveValue(s) {
  const v = oneLine(s).replace(/-->/g, '->').replace(/"/g, '”').replace(/'/g, '’');
  return `"${v}"`;
}

/**
 * Text inside a directive's parentheses, e.g. LAYOUT(name): no ")" and one line
 * @param {*} s - Value
 * @returns {string}
 */
export function parenValue(s) {
  return oneLine(s).replace(/-->/g, '->').replace(/\)/g, '');
}

/**
 * markdown-it-attrs value: always "…"; " becomes ', braces are removed and \ becomes /
 * (a backslash makes pagemd print the whole {…} block as text).
 * @param {*} s - Value
 * @returns {string} Quoted value
 */
export function attrValue(s) {
  return `"${oneLine(s).replace(/"/g, "'").replace(/[{}]/g, '').replace(/\\/g, '/')}"`;
}

/**
 * YAML double-quoted string. Unlike the image tool, a line break is kept (as \n):
 * annotated-image text notes may hold line breaks (C9, PD21).
 * @param {*} s - Value
 * @returns {string}
 */
export function yamlString(s) {
  let out = '"';
  for (const ch of String(s ?? '')) {
    const code = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (code < 0x20) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

/**
 * Markdown image alt text inside ![…]: \ becomes /, [[ ]] collapse to [ ], and
 * unbalanced brackets become parentheses.
 * @param {*} s - Value
 * @returns {string}
 */
export function markdownAlt(s) {
  let v = oneLine(s).replace(/\\/g, '/');
  while (v.includes('[[') || v.includes(']]')) v = v.replace(/\[\[/g, '[').replace(/\]\]/g, ']');
  let depth = 0;
  let balanced = true;
  for (const ch of v) {
    if (ch === '[') depth++;
    else if (ch === ']' && --depth < 0) { balanced = false; break; }
  }
  if (!balanced || depth !== 0) v = v.replace(/\[/g, '(').replace(/\]/g, ')');
  return v;
}

/**
 * Link or image destination: the <…> form when it has spaces, parentheses or angle brackets
 * @param {*} src - Path or URL
 * @returns {string}
 */
export function markdownDestination(src) {
  const v = oneLine(src);
  if (v.startsWith('data:')) return v;
  if (/[ ()<>]/.test(v)) return `<${v.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
  return v;
}

/**
 * Link or image title: "…" with \ and " escaped
 * @param {*} s - Title
 * @returns {string}
 */
export function markdownTitle(s) {
  return `"${oneLine(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Split a parameter string into its key=value segments, in the author's order.
 * @param {string} raw - The parameters as written
 * @param {RegExp} segmentRe - Global regex whose group 1 is the key
 * @returns {{key: string, text: string}[]}
 */
function segments(raw, segmentRe) {
  const out = [];
  const re = new RegExp(segmentRe.source, 'g');
  let m;
  while ((m = re.exec(raw || '')) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    out.push({ key: m[1], text: m[0] });
  }
  return out;
}

/**
 * Write parameters, keeping the author's text for every parameter whose value
 * did not change (order, quoting), rewriting changed ones in place, dropping
 * removed ones and appending new ones in the item's documented order.
 *
 * @param {object} spec
 * @param {Object<string, *>} spec.attrs - The parameters to write (true = a bare flag; '', null, undefined = omit)
 * @param {string} [spec.raw] - The parameters as the author wrote them
 * @param {(raw: string) => Object<string, *>} spec.parse - The item's own reader for raw
 * @param {RegExp} spec.segment - Regex matching one written parameter (group 1 = key)
 * @param {(value: string) => string} spec.quote - Escapes and quotes one value
 * @param {string[]} [spec.order] - Canonical order for new parameters (the item's params)
 * @param {boolean} [spec.flags] - Whether bare flags (value true) can be written
 * @returns {string}
 */
export function writeParams({ attrs = {}, raw = '', parse, segment, quote, order = [], flags = false }) {
  const before = raw ? parse(raw) : {};
  const format = (key, value) => {
    if (value === true && flags) return key;
    return `${key}=${quote(String(value))}`;
  };
  const present = (value) => value !== undefined && value !== null && value !== '' && value !== false;
  const out = [];
  const seen = new Set();
  for (const seg of segments(raw, segment)) {
    if (seen.has(seg.key)) continue;
    seen.add(seg.key);
    if (!(seg.key in attrs) || !present(attrs[seg.key])) continue;
    const same = String(attrs[seg.key]) === String(before[seg.key]);
    out.push(same ? seg.text : format(seg.key, attrs[seg.key]));
  }
  const added = Object.keys(attrs).filter((k) => !seen.has(k) && present(attrs[k]));
  const rank = (k) => (order.includes(k) ? order.indexOf(k) : order.length);
  added.sort((a, b) => rank(a) - rank(b));
  for (const key of added) out.push(format(key, attrs[key]));
  return out.join(' ');
}
