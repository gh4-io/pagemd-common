/**
 * Attribute container write rule (phase C3): ::: {.class #id key="value"} … :::
 *
 * The attributes keep the author's text when they did not change. Otherwise
 * they are written as `.class` names, `#id` and `key="value"` pairs, following
 * this container's own reader: class names and the id may only hold letters,
 * digits, `_` and `-` (others are dropped), and a value may not hold both kinds
 * of quote (" becomes ' then). The reader also finds `.word` and `#word` inside
 * quoted values, so such values do not read back unchanged.
 *
 * Canonical example:
 *   writeAttributeContainer({ attrs: [['class', 'note wide'], ['id', 'x']] }, 'Text')
 *   → '::: {.note .wide #x}\nText\n:::'
 */

const NAME = /^[A-Za-z0-9_-]+$/;
const KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * The attribute pairs this container's reader gets from `{…}` (same rules as attribute-container.js)
 * @param {string} text - The attributes as written, with braces
 * @returns {string[][]} [key, value] pairs
 */
export function readContainerAttributes(text) {
  const m = String(text || '').trim().match(/^\{(.+)\}$/);
  if (!m) return [];
  const inner = m[1];
  const pairs = [];
  const classes = (inner.match(/\.([a-zA-Z0-9_-]+)/g) || []).map((c) => c.slice(1));
  const id = inner.match(/#([a-zA-Z0-9_-]+)/);
  if (classes.length) pairs.push(['class', classes.join(' ')]);
  if (id) pairs.push(['id', id[1]]);
  const kv = /([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|'([^']*)')/g;
  const seen = new Set();
  let p;
  while ((p = kv.exec(inner)) !== null) {
    if (seen.has(p[1])) continue;
    seen.add(p[1]);
    pairs.push([p[1], p[2] ?? p[3]]);
  }
  return pairs;
}

/**
 * Normalise attributes given as pairs or an object into pairs
 * @param {string[][]|Object<string, string>} attrs
 * @returns {string[][]}
 */
function toPairs(attrs) {
  if (!attrs) return [];
  return Array.isArray(attrs) ? attrs.map(([k, v]) => [String(k), String(v)]) : Object.entries(attrs).map(([k, v]) => [k, String(v)]);
}

/**
 * Same attributes, ignoring order
 * @param {string[][]} a
 * @param {string[][]} b
 * @returns {boolean}
 */
function samePairs(a, b) {
  const key = (pairs) => JSON.stringify([...pairs].map(([k, v]) => [k, String(v)]).sort());
  return key(a) === key(b);
}

/**
 * Format attribute pairs as this container's `{…}`
 * @param {string[][]} pairs
 * @returns {string}
 */
export function formatContainerAttributes(pairs) {
  const parts = [];
  const rest = [];
  for (const [k, v] of pairs) {
    if (k === 'class') parts.unshift(...String(v).split(/\s+/).filter((c) => NAME.test(c)).map((c) => `.${c}`));
    else if (k === 'id') { if (NAME.test(v)) rest.unshift(`#${v}`); }
    else if (KEY.test(k)) {
      const value = String(v).replace(/[\r\n]+/g, ' ');
      if (!value.includes('"')) rest.push(`${k}="${value}"`);
      else if (!value.includes("'")) rest.push(`${k}='${value}'`);
      else rest.push(`${k}="${value.replace(/"/g, "'")}"`);
    }
  }
  return `{${[...parts, ...rest].join(' ')}}`;
}

/**
 * Write an attribute container back to markdown
 * @param {object} data - What the div_open token carries (`meta.attributes`, `attrs`)
 * @param {string} [data.attributes] - The `{…}` as written
 * @param {string[][]|Object<string, string>} [data.attrs] - The attributes to write
 * @param {string} [content] - The already-written inner markdown
 * @returns {string}
 */
export function writeAttributeContainer(data, content = '') {
  const pairs = data.attrs === undefined ? readContainerAttributes(data.attributes) : toPairs(data.attrs);
  const asWritten = data.attributes && samePairs(readContainerAttributes(data.attributes), pairs);
  const head = asWritten ? String(data.attributes).trim() : formatContainerAttributes(pairs);
  const body = String(content).replace(/\n+$/, '');
  return `::: ${head}\n${body ? `${body}\n` : ''}:::`;
}
