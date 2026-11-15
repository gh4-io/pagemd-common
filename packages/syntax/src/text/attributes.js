/**
 * Attributes {.class #id key="value"} (markdown-it-attrs), on the element before them.
 *
 * Write rule (phase C3, A10): `writeAttributes()` formats the `{…}` block an
 * editor appends after a heading, paragraph, image or link. Values follow the
 * A3 escaping: always "…", " becomes ', braces are removed and \ becomes /
 * (a backslash makes pagemd print the whole block as text). Keys that
 * markdown-it-attrs would not read, class names with spaces or braces and an
 * id with spaces are written as key="value" pairs instead.
 *
 * Reader limit: markdown reads emphasis first, so names or values holding a
 * pair of "_" or "*" (e.g. `.a_b_`) can break the block; such attributes do
 * not read back.
 *
 * Canonical example:
 *   writeAttributes([['id', 'intro'], ['class', 'lead wide'], ['data-x', '1']])
 *   → '{#intro .lead .wide data-x="1"}'
 */

import markdownItAttrs from 'markdown-it-attrs';
import { attrValue } from '../shared/write.js';
import { isEditor } from '../shared/mode.js';

const SIMPLE = /^[^\s{}"'#.=\\]+$/;
const KEY = /^[A-Za-z_:][\w:.-]*$/;

/**
 * Format attributes as a markdown-it-attrs `{…}` block
 * @param {string[][]|Object<string, string>} attrs - [key, value] pairs (or an object)
 * @returns {string} '' when there is nothing to write
 */
export function writeAttributes(attrs) {
  const pairs = Array.isArray(attrs) ? attrs : Object.entries(attrs || {});
  const parts = [];
  for (const [key, raw] of pairs) {
    const value = String(raw ?? '');
    if (key === 'id' && SIMPLE.test(value)) parts.push(`#${value}`);
    else if (key === 'class' && value.split(/\s+/).filter(Boolean).every((c) => SIMPLE.test(c))) {
      parts.push(...value.split(/\s+/).filter(Boolean).map((c) => `.${c}`));
    } else if (KEY.test(key)) parts.push(`${key}=${attrValue(value)}`);
  }
  return parts.length ? `{${parts.join(' ')}}` : '';
}

/**
 * A table's line range includes a `{…}` line below it (phase P4, editor mode,
 * so render mode's rule list stays as it was; ranges don't change HTML). markdown-it-attrs moves such a paragraph's
 * attributes onto the table and removes the paragraph, whose lines would then
 * belong to no block. Before its rule runs, each table followed by a paragraph
 * is noted; afterwards, a table whose paragraph was removed takes its lines.
 * @param {MarkdownIt} md
 */
function tableAttributeLines(md) {
  /** @type {WeakMap<object, {table: object, paragraph: object}[]>} */
  const pending = new WeakMap();
  md.core.ruler.before('curly_attributes', 'pagemd_table_attrs_note', (state) => {
    const found = [];
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i].type !== 'table_close' || tokens[i + 1].type !== 'paragraph_open') continue;
      let depth = 0;
      for (let k = i; k >= 0; k--) {
        if (tokens[k].type === 'table_close') depth++;
        if (tokens[k].type === 'table_open' && --depth === 0) {
          found.push({ table: tokens[k], paragraph: tokens[i + 1] });
          break;
        }
      }
    }
    pending.set(state, found);
  });
  md.core.ruler.after('curly_attributes', 'pagemd_table_attrs_range', (state) => {
    const found = pending.get(state) || [];
    if (!found.length) return;
    const kept = new Set(state.tokens);
    for (const { table, paragraph } of found) {
      if (kept.has(paragraph) || !table.map || !paragraph.map) continue;
      table.map = [table.map[0], Math.max(table.map[1], paragraph.map[1])];
    }
  });
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'attributes',
  group: 'text',
  read(md) {
    md.use(markdownItAttrs);
    if (isEditor(md)) tableAttributeLines(md);
  },
  write: (data) => writeAttributes(data.attrs),
  htmlContract: ['class="…" id="…" key="value" on the preceding element'],
  params: []
};
