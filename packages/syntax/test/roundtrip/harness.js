/**
 * Round-trip harness (phase C3): read (editor mode) → write → read again, and
 * compare the item's data. "Same after a round trip" (≅) means the item's
 * data is equal; line numbers and the author's raw text are ignored.
 *
 * Used by this package's tests and by pagemd's corpus test
 * (pagemd/tests/editor-mode/, which imports this file by its path).
 */

import { createDialect, items, itemOccurrences, writeDirective, sameData } from '../../src/index.js';
import { normalizeAnnotationData } from '../../src/media/annotated-image.js';

/** An editor-mode dialect with every item on (fancy lists too) */
export function editorDialect(options = {}) {
  return createDialect({ mode: 'editor', options: { fields: { fancy_lists: true }, ...options } });
}

const byId = (id) => items.find((i) => i.id === id);

/** The markdown-it-container inner lines, or the attribute container's */
function innerLines(o, lines) {
  const [start, end] = o.token.map;
  if (o.item === 'attribute-container') return lines.slice(start + 1, o.token.meta.closed ? end - 1 : end);
  return lines.slice(start + 1, end);
}

/** Remove the opening line's indentation from every line */
function dedent(block, indent) {
  return block.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()));
}

/**
 * The inner markdown of a wrapper occurrence, from the source
 * @returns {string|undefined|null} null = can't be taken out on its own (skip)
 */
export function contentOf(o, tokens, lines) {
  if (o.item === 'callouts') {
    const inline = tokens[o.index + 3];
    return inline && inline.type === 'inline' ? inline.content : '';
  }
  if (o.item === 'containers' || o.item === 'attribute-container') {
    const open = lines[o.token.map[0]];
    if (/^\s*>/.test(open)) return null;
    const indent = open.match(/^\s*/)[0];
    return dedent(innerLines(o, lines), indent).join('\n');
  }
  if (o.item === 'github-alerts') {
    const inner = lines.slice(o.token.map[0] + 1, o.token.map[1]);
    if (inner.some((l) => !/^\s*>/.test(l))) return null;
    return inner.map((l) => l.replace(/^\s*> ?/, '')).join('\n');
  }
  if (o.item === 'footnotes' && o.data.form === 'definition') {
    const [start, end] = o.token.map;
    const open = lines[start];
    if (/^\s*>/.test(open)) return null;
    const indent = open.match(/^\s*/)[0];
    const head = open.slice(indent.length).replace(/^\[\^[^\]]*\]:[ \t]?/, '');
    const rest = lines.slice(start + 1, end).map((l) => (l.startsWith(`${indent}    `) ? l.slice(indent.length + 4) : l.trim() === '' ? '' : l.trimStart()));
    return [head, ...rest].join('\n').replace(/\n+$/, '');
  }
  return undefined;
}

/**
 * Write one occurrence back to markdown
 */
export function writeOccurrence(o, content) {
  if (o.item === 'unknown-directive') return writeDirective(o.data);
  const item = byId(o.item);
  if (o.item === 'fancy-lists') return `${item.write({ ...o.data, index: 0 })}  item`;
  // A reference reads as one only when its note exists; a task marker belongs at the start of a list item
  if (o.item === 'footnotes' && o.data.form === 'ref') return `Text${item.write(o.data)}\n\n[^${o.data.label}]: Note`;
  if (o.item === 'task-lists') return `- ${item.write(o.data)}item`;
  if (o.item === 'attributes') {
    const w = item.write(o.data);
    return o.token.type === 'heading_open' ? `${o.token.markup} Title ${w}` : `Text ${w}`;
  }
  return item.write(o.data, content);
}

/**
 * What must survive a round trip, per item
 */
export function comparable(o, content) {
  const d = o.data;
  const str = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, v === true ? true : String(v)]));
  switch (o.item) {
    case 'figure': return { attrs: str(d.attrs), legacy: !!d.legacy, image: d.legacy ? d.image : '' };
    case 'annotated-image': return { imagePath: d.imagePath, data: normalizeAnnotationData(d.data) };
    case 'include': return { path: d.path };
    case 'callouts': return { type: d.type, form: d.form, text: String(content ?? '').trim() };
    case 'attribute-container': return { attrs: [...d.attrs].map(([k, v]) => [k, String(v)]).sort() };
    case 'containers': return { name: d.name, title: d.title };
    case 'github-alerts': return { type: d.type, title: d.title };
    case 'multimd-table': return d;
    case 'fancy-lists': return { type: d.type, start: d.start, delimiter: d.delimiter };
    case 'attributes': return { attrs: [...d.attrs].map(([k, v]) => [k, String(v)]).sort() };
    case 'wikilinks': return { target: d.target, display: d.display };
    case 'embeds': return { path: d.path, alt: d.alt };
    case 'inline-callout': return { type: d.type };
    case 'footnotes': return d.form === 'definition' ? { form: d.form, label: d.label, text: String(content ?? '').trim() } : { ...d };
    case 'task-lists': return { checked: d.checked, mark: d.mark, gap: d.gap };
    default: return { name: d.name, parenParams: d.parenParams ?? null, attrs: str(d.attrs) };
  }
}

/**
 * Round-trip every pagemd item in a document
 * @param {string} src - Markdown
 * @param {object} [md] - Editor-mode dialect
 * @returns {{checked: number, skipped: number, failures: object[]}}
 */
export function roundTripDocument(src, md = editorDialect()) {
  const tokens = md.parse(src, {});
  const lines = src.split('\n');
  const failures = [];
  let checked = 0;
  let skipped = 0;
  for (const o of itemOccurrences(tokens)) {
    const content = contentOf(o, tokens, lines);
    if (content === null) { skipped++; continue; }
    const result = roundTripOccurrence(o, content, md);
    checked++;
    if (!result.ok) failures.push({ item: o.item, line: o.token.map ? o.token.map[0] : null, ...result });
  }
  return { checked, skipped, failures };
}

/**
 * Round-trip one occurrence
 */
export function roundTripOccurrence(o, content, md = editorDialect()) {
  const written = writeOccurrence(o, content);
  const again = md.parse(written, {});
  const lines = written.split('\n');
  const match = itemOccurrences(again).find((x) => x.item === o.item);
  const before = comparable(o, content);
  const after = match ? comparable(match, contentOf(match, again, lines)) : null;
  return { ok: !!match && sameData(before, after), written, before, after };
}
