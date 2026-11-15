/**
 * <!-- ::TABLE widths="30% 20% 50%" --> under a table (pagemd-editor P19, round 3): the table's column widths, kept in an
 * HTML comment so other markdown viewers (GitHub, VS Code's preview, …) show nothing.
 *
 *   | Item | Qty | Notes |
 *   |------|-----|-------|
 *   | Bolts | 4 | Stainless |
 *   <!-- ::TABLE widths="50% 15% 35%" -->
 *
 * - It belongs to the table right above it: the next block after the table (the table's own `{…}` line may sit
 *   between). Anywhere else it does nothing (the `syntax` validation level says so).
 * - `widths`: the same values as `data-col-widths` (column-widths.js), or `equal` for equal columns (what
 *   `.fixed-layout` does). Both older spellings (`{data-col-widths="…"}`, `{.fixed-layout}`) keep working; when both
 *   are written, the comment wins.
 * - Render mode: the comment prints nothing; the table's widths are written by column-widths.js's rule, which looks
 *   at the block after each table. Editor mode: the comment is folded into the table: `table_open.meta.tableDirective`
 *   ({ name, parenParams, params, attrs }, as a directive token carries them) and the table's line range grows over it, so an editor
 *   holds table and comment as one block and writes them back together (`writeTableDirective`).
 * - An older pagemd doesn't know TABLE and prints `<!-- Unknown directive: TABLE -->`: still invisible.
 */

import { registerDirective, writeDirective, parseDirectiveAttributes } from '../shared/directives.js';
import { isEditor } from '../shared/mode.js';

/** The directive's keyword */
export const TABLE_DIRECTIVE = 'TABLE';
/** `widths="equal"`: equal columns (the fixed layout without widths) */
export const EQUAL_WIDTHS = 'equal';

const RE = /^<!--\s*::TABLE(?:\s+(.*?))?\s*-->$/;

/**
 * The attributes of a TABLE directive token (an `html_block` in render mode, a `pagemd_directive` in editor mode)
 * @param {object|undefined} token
 * @returns {Object<string, string|true>|null} null when the token isn't one
 */
export function tableDirectiveAttrs(token) {
  if (!token) return null;
  if (token.type === 'pagemd_directive') return token.meta?.name === TABLE_DIRECTIVE ? (token.meta.attrs || {}) : null;
  if (token.type !== 'html_block') return null;
  const match = RE.exec(String(token.content || '').trim());
  return match ? parseDirectiveAttributes(match[1] || '') : null;
}

/** Index of the `table_close` that closes the `table_open` at `open` */
export function tableCloseOf(tokens, open) {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].type === 'table_open') depth++;
    if (tokens[i].type === 'table_close' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Write the comment (an editor's write rule). Parameters not changed keep the author's text (C3's writeDirective).
 * @param {{params?: string, attrs?: Object<string, string|true>}} data
 * @returns {string} '' when there is nothing to write
 */
export function writeTableDirective(data) {
  const attrs = data?.attrs || {};
  if (!Object.keys(attrs).length) return '';
  return writeDirective({ name: TABLE_DIRECTIVE, params: data.params || '', attrs }, ['widths']);
}

/**
 * Editor mode: fold each TABLE directive that follows a table into it (meta + line range); the token goes.
 * @param {object} state - markdown-it core state
 */
function foldIntoTables(state) {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'table_open') continue;
    const close = tableCloseOf(tokens, i);
    const next = tokens[close + 1];
    const attrs = tableDirectiveAttrs(next);
    if (close < 0 || !attrs) continue;
    const open = tokens[i];
    open.meta = { ...(open.meta || {}), tableDirective: { name: TABLE_DIRECTIVE, parenParams: null, params: next.meta.params || '', attrs } };
    if (open.map && next.map) open.map = [open.map[0], Math.max(open.map[1], next.map[1])];
    tokens.splice(close + 1, 1);
  }
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'table-directive',
  group: 'tables',
  read(md) {
    // Render mode: the comment prints nothing (its widths were already read by column-widths.js's rule).
    registerDirective(md, TABLE_DIRECTIVE, (token) => {
      token.content = '';
      return true;
    }, { item: 'table-directive' });
    if (isEditor(md)) md.core.ruler.after('pagemd_directives', 'pagemd_table_directive', foldIntoTables);
  },
  write: writeTableDirective,
  htmlContract: ['(nothing: the widths go into the table above, see the column widths rule)'],
  params: [
    { key: 'widths', type: 'string', label: 'Column widths', help: 'One per column, left to right: 30%, 30, 0.3 (a fraction), * (not set); or equal' }
  ]
};
